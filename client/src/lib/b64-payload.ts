const PREFIX = "__b64__:";

export function encodeForWaf(s: string): string {
  if (typeof s !== "string" || s.length === 0) return s;
  const b64 = typeof window === "undefined"
    ? Buffer.from(s, "utf8").toString("base64")
    : btoa(unescape(encodeURIComponent(s)));
  return PREFIX + b64;
}
