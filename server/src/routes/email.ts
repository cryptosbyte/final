import crypto from "crypto";
import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import {
  ALLOWED_GMAIL_ADDRESS,
  CONTACT_ADDRESS,
  OWNER_USER_ID,
} from "../lib/emailConfig";
import {
  buildAuthUrl,
  deleteTokensForUser,
  exchangeCode,
  getMessageDetail,
  getStoredTokens,
  getUserInfoEmail,
  GmailNotConnectedError,
  listInboxMessages,
  parseEmailAddress,
  saveTokensForUser,
} from "../lib/gmail";
import { sendEmailViaBrevo } from "../lib/brevo";

const router: IRouter = Router();

const STATE_COOKIE = "gmail_oauth_state";

// Surface emails delivered to the contact address (ImprovMX forwards them to
// the connected Gmail account, but the original recipient header is preserved).
const INBOX_QUERY = `to:${CONTACT_ADDRESS} OR deliveredto:${CONTACT_ADDRESS} OR cc:${CONTACT_ADDRESS}`;

function ownerOnly(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.user.id !== OWNER_USER_ID) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

function handleGmailError(err: unknown, res: Response) {
  if (err instanceof GmailNotConnectedError) {
    res.status(409).json({ error: "gmail_not_connected" });
    return;
  }
  console.error("Email route error:", err);
  res.status(500).json({ error: "Email request failed" });
}

router.use("/email", ownerOnly);

router.get("/email/status", async (req: Request, res: Response) => {
  let row: Awaited<ReturnType<typeof getStoredTokens>> | null = null;
  try {
    row = await getStoredTokens(req.user!.id);
  } catch (err) {
    // If the token store is unavailable (e.g. table not yet migrated to this
    // environment), treat it as "not connected" so the UI shows the connect
    // flow instead of a hard 500.
    console.error("Failed to read Gmail token status:", err);
  }
  res.set("Cache-Control", "no-store");
  res.json({
    connected: !!row?.refreshToken,
    email: row?.email ?? null,
    contactAddress: CONTACT_ADDRESS,
  });
});

router.get("/email/auth-url", (req: Request, res: Response) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    res.status(500).json({ error: "Google OAuth is not configured" });
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  });
  res.json({ url: buildAuthUrl(state) });
});

router.post("/email/oauth/exchange", async (req: Request, res: Response) => {
  const { code, state } = req.body as { code?: string; state?: string };
  const savedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: "/" });

  if (!code || !state || !savedState || state !== savedState) {
    res.status(400).json({ error: "Invalid OAuth state or missing code" });
    return;
  }

  try {
    const tokens = await exchangeCode(code);
    const email = await getUserInfoEmail(tokens.access_token);
    if (
      ALLOWED_GMAIL_ADDRESS &&
      (email ?? "").trim().toLowerCase() !== ALLOWED_GMAIL_ADDRESS
    ) {
      res.status(400).json({
        error: "wrong_account",
        message: `Connect the ${ALLOWED_GMAIL_ADDRESS} account (contact@zakir.today is forwarded there). You authorized ${email ?? "an unknown account"}.`,
      });
      return;
    }
    await saveTokensForUser(req.user!.id, tokens, email);
    res.json({ connected: true, email });
  } catch (err) {
    console.error("Gmail OAuth exchange failed:", err);
    res.status(500).json({ error: "Gmail authorization failed" });
  }
});

router.post("/email/disconnect", async (req: Request, res: Response) => {
  await deleteTokensForUser(req.user!.id);
  res.json({ success: true });
});

router.get("/email/messages", async (req: Request, res: Response) => {
  try {
    const pageToken =
      typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;
    const result = await listInboxMessages(req.user!.id, INBOX_QUERY, pageToken);
    res.set("Cache-Control", "no-store");
    res.json(result);
  } catch (err) {
    handleGmailError(err, res);
  }
});

router.get("/email/messages/:id", async (req: Request, res: Response) => {
  try {
    const message = await getMessageDetail(req.user!.id, String(req.params.id));
    res.set("Cache-Control", "no-store");
    res.json({ message });
  } catch (err) {
    handleGmailError(err, res);
  }
});

router.post("/email/reply", async (req: Request, res: Response) => {
  const { to, subject, text, html, inReplyTo, references } = req.body as {
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
    inReplyTo?: string;
    references?: string;
  };

  if (!to || !subject || (!text && !html)) {
    res
      .status(400)
      .json({ error: "to, subject and a message body are required" });
    return;
  }

  try {
    await sendEmailViaBrevo({
      to: parseEmailAddress(to),
      subject,
      text,
      html,
      inReplyTo,
      references,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Reply send failed:", err);
    res.status(500).json({ error: "Failed to send reply" });
  }
});

// Compose a brand-new email (not a reply to an existing thread). Sent from the
// contact address via Brevo, same as replies but without threading headers.
router.post("/email/send", async (req: Request, res: Response) => {
  const { to, subject, text, html } = req.body as {
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
  };

  const trimmedTo = to?.trim() ?? "";
  const trimmedSubject = subject?.trim() ?? "";

  if (!trimmedTo || !trimmedSubject || (!text?.trim() && !html?.trim())) {
    res
      .status(400)
      .json({ error: "to, subject and a message body are required" });
    return;
  }

  const recipient = parseEmailAddress(trimmedTo);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    res.status(400).json({ error: "A valid recipient email is required" });
    return;
  }

  try {
    await sendEmailViaBrevo({
      to: recipient,
      subject: trimmedSubject,
      text,
      html,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Compose send failed:", err);
    res.status(500).json({ error: "Failed to send email" });
  }
});

export default router;
