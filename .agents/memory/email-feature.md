---
name: Owner-only Gmail email feature
description: Non-obvious constraints for the zakir.today owner email tab (Gmail read + Brevo reply)
---

# Owner-only email tab (zakir.today)

Owner-only inbox visible only to `req.user.id === "github:74561974"`. Owner reads
mail forwarded to contact@zakir.today (ImprovMX → a Gmail account) via the Gmail
REST API, and replies via Brevo's HTTP transactional API.

## Constraints that code cannot tell you
- **Gmail connect is production-only.** The OAuth redirect is `https://zakir.today/email`
  (registered in Google Cloud console). It is NOT registered for the dev preview
  domain, so the "Connect Gmail" flow can only be completed on the deployed site.
  Dev preview can exercise everything else (gating, UI), just not the OAuth round-trip.
- **A plain `GOOGLE_API_KEY` cannot read a private mailbox.** Reading Gmail requires
  full OAuth2: client id + client secret + a stored refresh token. Don't try to
  "simplify" this back to an API key.
- **Account binding guard:** OAuth exchange rejects any Google account whose email
  != `EMAIL_ALLOWED_GMAIL` (defaults to the forwarded Gmail). Empty env disables it.
- **Brevo:** replies use the HTTP transactional API (`api.brevo.com/v3/smtp/email`,
  `api-key` header), NOT SMTP. If `BREVO_SMTP_API_KEY` turns out to be SMTP-only,
  pivot to nodemailer against `smtp-relay.brevo.com:587`.

## App runtime shape (this is the ACTIVE app, at repo ROOT — not the empty nested `revision-dashboard/` dir)
- Vite client on port 5000 (the webview), Express API on 3001, with vite proxying
  `/api` → 3001. Access locally via `localhost:5000`, NOT the monorepo `localhost:80`
  proxy — this app predates that proxy setup.
- **Why it matters:** the "Revision Dashboard" workflow was once `cd revision-dashboard && ...`
  pointing at the empty nested dir; correct command runs from root: `PORT=5000 npm run dev`.
