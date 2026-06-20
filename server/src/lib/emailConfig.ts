// Configuration for the owner-only email (contact@zakir.today) inbox feature.
// Reading the Gmail inbox requires full OAuth2 (client id + client secret +
// refresh token); a plain API key cannot read a private mailbox. Replies are
// sent via Brevo's transactional email API.

export const OWNER_USER_ID =
  process.env.EMAIL_OWNER_USER_ID || "github:74561974";

// Emails forwarded to this address (via ImprovMX) are what we surface.
export const CONTACT_ADDRESS =
  process.env.EMAIL_CONTACT_ADDRESS || "contact@zakir.today";

// Replies are sent from this address through Brevo.
export const REPLY_FROM_EMAIL =
  process.env.EMAIL_REPLY_FROM || CONTACT_ADDRESS;
export const REPLY_FROM_NAME = process.env.EMAIL_REPLY_FROM_NAME || "Zakir";

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
export const GOOGLE_OAUTH_REDIRECT =
  process.env.GOOGLE_OAUTH_REDIRECT || "https://zakir.today/email";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];
