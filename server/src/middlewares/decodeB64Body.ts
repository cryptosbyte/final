import type { Request, Response, NextFunction } from "express";

const PREFIX = "__b64__:";
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeString(s: string): string {
  if (!s.startsWith(PREFIX)) return s;
  const payload = s.slice(PREFIX.length);
  if (payload.length === 0 || payload.length % 4 !== 0 || !BASE64_RE.test(payload)) {
    return s;
  }
  try {
    const decoded = Buffer.from(payload, "base64").toString("utf8");
    // Roundtrip verification: only accept if re-encoding produces the exact same payload.
    // Node's base64 decoder is permissive, so this guards against silently corrupting
    // user-typed content that happens to start with the prefix.
    const reencoded = Buffer.from(decoded, "utf8").toString("base64");
    if (reencoded !== payload) return s;
    return decoded;
  } catch {
    return s;
  }
}

function walk(value: unknown): unknown {
  if (typeof value === "string") return decodeString(value);
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walk(v);
    }
    return out;
  }
  return value;
}

export function decodeB64Body(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === "object") {
    req.body = walk(req.body);
  }
  next();
}
