import { REPLY_FROM_EMAIL, REPLY_FROM_NAME } from "./emailConfig";

interface SendArgs {
  to: string;
  toName?: string;
  subject: string;
  html?: string;
  text?: string;
  inReplyTo?: string;
  references?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Sends an email through Brevo's transactional email API. The configured key
// (BREVO_SMTP_API_KEY) is sent via the `api-key` header.
export async function sendEmailViaBrevo(args: SendArgs): Promise<void> {
  const apiKey = process.env.BREVO_SMTP_API_KEY;
  if (!apiKey) {
    throw new Error("BREVO_SMTP_API_KEY is not configured");
  }

  const headers: Record<string, string> = {};
  if (args.inReplyTo) {
    headers["In-Reply-To"] = args.inReplyTo;
    headers["References"] = args.references || args.inReplyTo;
  }

  const htmlContent =
    args.html ||
    `<div>${escapeHtml(args.text ?? "").replace(/\n/g, "<br>")}</div>`;

  const body: Record<string, unknown> = {
    sender: { email: REPLY_FROM_EMAIL, name: REPLY_FROM_NAME },
    to: [{ email: args.to, ...(args.toName ? { name: args.toName } : {}) }],
    subject: args.subject,
    htmlContent,
  };
  if (args.text) body.textContent = args.text;
  if (Object.keys(headers).length) body.headers = headers;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Brevo send failed: ${res.status} ${await res.text()}`);
  }
}
