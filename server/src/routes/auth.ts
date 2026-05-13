import { Router, type IRouter, type Request, type Response } from "express";
import { GetCurrentAuthUserResponse } from "../shared/api";
import { db, usersTable } from "../db";
import {
  clearSession,
  getSessionId,
  createSession,
  SESSION_COOKIE,
  SESSION_TTL,
  fetchGitHubUser,
  fetchGitHubUserEmail,
  type SessionData,
} from "../lib/auth";

const router: IRouter = Router();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host =
    req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}`;
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

async function upsertUser(githubId: string, email: string | null, name: string | null, avatarUrl: string | null) {
  const nameParts = (name ?? "").trim().split(/\s+/);
  const firstName = nameParts[0] || null;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

  const userData = {
    id: `github:${githubId}`,
    email,
    firstName,
    lastName,
    profileImageUrl: avatarUrl,
  };

  const [user] = await db
    .insert(usersTable)
    .values(userData)
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        ...userData,
        updatedAt: new Date(),
      },
    })
    .returning();
  return user;
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.get("/login", (req: Request, res: Response) => {
  if (!GITHUB_CLIENT_ID) {
    res.status(500).json({ error: "GITHUB_CLIENT_ID is not configured" });
    return;
  }

  const returnTo = getSafeReturnTo(req.query.returnTo);
  const state = `${returnTo}|${Math.random().toString(36).slice(2)}`;
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: callbackUrl,
    scope: "user:email read:user",
    state,
  });

  res.cookie("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get("/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const savedState = req.cookies?.oauth_state;

  res.clearCookie("oauth_state", { path: "/" });

  if (!code || !state || !savedState || state !== savedState) {
    res.status(400).json({ error: "Invalid OAuth state or missing code" });
    return;
  }

  const returnTo = getSafeReturnTo((state as string).split("|")[0]);
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  let accessToken: string;
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenRes.ok) {
      const tokenText = await tokenRes.text();
      throw new Error(`Token exchange failed: ${tokenRes.status} ${tokenText}`);
    }
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string };

    if (tokenData.error || !tokenData.access_token) {
      throw new Error(tokenData.error_description ?? tokenData.error ?? "No access token received");
    }
    accessToken = tokenData.access_token;
  } catch (err) {
    res.status(500).json({ error: "GitHub OAuth token exchange failed" });
    return;
  }

  let githubUser: Awaited<ReturnType<typeof fetchGitHubUser>>;
  try {
    githubUser = await fetchGitHubUser(accessToken);
  } catch {
    res.status(500).json({ error: "GitHub user fetch failed" });
    return;
  }

  let email = githubUser.email;
  if (!email) {
    email = await fetchGitHubUserEmail(accessToken);
  }

  let dbUser: Awaited<ReturnType<typeof upsertUser>>;
  try {
    dbUser = await upsertUser(
      String(githubUser.id),
      email,
      githubUser.name,
      githubUser.avatar_url,
    );
  } catch (err) {
    console.error("Failed to upsert user:", err);
    res.status(500).json({ error: "Failed to save user to database", detail: String(err) });
    return;
  }

  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
    },
  };

  let sid: string;
  try {
    sid = await createSession(sessionData);
  } catch (err) {
    console.error("Failed to create session:", err);
    res.status(500).json({ error: "Failed to create session", detail: String(err) });
    return;
  }

  setSessionCookie(res, sid);
  res.redirect(returnTo);
});

router.get("/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.redirect("/");
});

export default router;