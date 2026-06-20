import { eq } from "drizzle-orm";
import { db, gmailTokensTable } from "../db";
import {
  GMAIL_SCOPES,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_OAUTH_REDIRECT,
} from "./emailConfig";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailNotConnectedError extends Error {
  constructor() {
    super("Gmail not connected");
    this.name = "GmailNotConnectedError";
  }
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  id_token?: string;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_OAUTH_REDIRECT,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string): Promise<GoogleTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_OAUTH_REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export async function getUserInfoEmail(
  accessToken: string,
): Promise<string | null> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { email?: string };
  return data.email ?? null;
}

export async function getStoredTokens(userId: string) {
  const [row] = await db
    .select()
    .from(gmailTokensTable)
    .where(eq(gmailTokensTable.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function saveTokensForUser(
  userId: string,
  tokens: GoogleTokenResponse,
  email: string | null,
) {
  const existing = await getStoredTokens(userId);
  const values = {
    userId,
    email: email ?? existing?.email ?? null,
    accessToken: tokens.access_token,
    // Google only returns a refresh_token on the first consent; keep the
    // previous one on subsequent refreshes.
    refreshToken: tokens.refresh_token ?? existing?.refreshToken ?? null,
    expiryDate: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope ?? existing?.scope ?? null,
  };
  await db
    .insert(gmailTokensTable)
    .values(values)
    .onConflictDoUpdate({
      target: gmailTokensTable.userId,
      set: { ...values, updatedAt: new Date() },
    });
}

export async function deleteTokensForUser(userId: string) {
  await db.delete(gmailTokensTable).where(eq(gmailTokensTable.userId, userId));
}

async function forceRefreshAccessToken(userId: string): Promise<string> {
  const row = await getStoredTokens(userId);
  if (!row || !row.refreshToken) {
    throw new GmailNotConnectedError();
  }
  const refreshed = await refreshAccessToken(row.refreshToken);
  await saveTokensForUser(userId, refreshed, row.email);
  return refreshed.access_token;
}

async function getValidAccessToken(userId: string): Promise<string> {
  const row = await getStoredTokens(userId);
  if (!row || !row.refreshToken) {
    throw new GmailNotConnectedError();
  }
  if (row.accessToken && row.expiryDate && row.expiryDate - 60_000 > Date.now()) {
    return row.accessToken;
  }
  const refreshed = await refreshAccessToken(row.refreshToken);
  await saveTokensForUser(userId, refreshed, row.email);
  return refreshed.access_token;
}

async function gmailApi<T>(userId: string, path: string): Promise<T> {
  let token = await getValidAccessToken(userId);
  let res = await fetch(`${GMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // The stored access token can be revoked/invalidated before its recorded
  // expiry; on a 401 force one refresh and retry before giving up.
  if (res.status === 401) {
    token = await forceRefreshAccessToken(userId);
    res = await fetch(`${GMAIL_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  if (!res.ok) {
    throw new Error(`Gmail API error: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}
interface GmailMessageFull {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}
interface GmailListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

function decodeB64Url(data: string): string {
  return Buffer.from(
    data.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf-8");
}

function getHeader(part: GmailPart | undefined, name: string): string {
  return (
    part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

function extractBodies(
  part: GmailPart | undefined,
  acc: { text?: string; html?: string },
) {
  if (!part) return;
  const mime = part.mimeType ?? "";
  if (mime === "text/plain" && part.body?.data && acc.text === undefined) {
    acc.text = decodeB64Url(part.body.data);
  } else if (mime === "text/html" && part.body?.data && acc.html === undefined) {
    acc.html = decodeB64Url(part.body.data);
  }
  if (part.parts) for (const p of part.parts) extractBodies(p, acc);
}

export interface MessageSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
}

export interface MessageDetail extends MessageSummary {
  messageId: string;
  references: string;
  html: string;
  text: string;
}

export async function listInboxMessages(
  userId: string,
  query: string,
  pageToken?: string,
): Promise<{ messages: MessageSummary[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({ q: query, maxResults: "25" });
  if (pageToken) params.set("pageToken", pageToken);
  const list = await gmailApi<GmailListResponse>(
    userId,
    `/messages?${params}`,
  );
  const ids = list.messages ?? [];
  const messages = await Promise.all(
    ids.map((m) => getMessageMeta(userId, m.id)),
  );
  return { messages, nextPageToken: list.nextPageToken ?? null };
}

export async function getMessageMeta(
  userId: string,
  id: string,
): Promise<MessageSummary> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "To", "Subject", "Date"]) {
    params.append("metadataHeaders", h);
  }
  const msg = await gmailApi<GmailMessageFull>(userId, `/messages/${id}?${params}`);
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(msg.payload, "From"),
    to: getHeader(msg.payload, "To"),
    subject: getHeader(msg.payload, "Subject") || "(no subject)",
    date:
      getHeader(msg.payload, "Date") ||
      (msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : ""),
    snippet: msg.snippet ?? "",
    unread: msg.labelIds?.includes("UNREAD") ?? false,
  };
}

export async function getMessageDetail(
  userId: string,
  id: string,
): Promise<MessageDetail> {
  const msg = await gmailApi<GmailMessageFull>(userId, `/messages/${id}?format=full`);
  const bodies: { text?: string; html?: string } = {};
  extractBodies(msg.payload, bodies);
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(msg.payload, "From"),
    to: getHeader(msg.payload, "To"),
    subject: getHeader(msg.payload, "Subject") || "(no subject)",
    date: getHeader(msg.payload, "Date"),
    messageId:
      getHeader(msg.payload, "Message-ID") ||
      getHeader(msg.payload, "Message-Id"),
    references: getHeader(msg.payload, "References"),
    html: bodies.html ?? "",
    text: bodies.text ?? "",
    snippet: msg.snippet ?? "",
    unread: msg.labelIds?.includes("UNREAD") ?? false,
  };
}

// Extract the bare email address from a "Name <email@x.com>" header value.
export function parseEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim();
}
