---
name: Hosting & production database
description: Where this app is hosted and how production DB changes are applied.
---

The revision tracker (zakir.today) is hosted on **Railway**, and its production
database is **Neon Postgres** — neither is Replit. The Replit `DATABASE_URL` here is a
separate dev DB; it is NOT the Neon prod DB.

**Why:** It changes how production fixes ship. A missing prod table (e.g. `gmail_tokens`)
or any schema change must be applied to the Neon DB directly (Neon SQL editor or
`DATABASE_URL=<neon-url> npm run db:push`), NOT by calling `suggest_deploy` / Replit
publish. Env vars / secrets (e.g. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT`) live on Railway, not Replit — Replit secrets do not reach prod.

**How to apply:** Do dev work in Replit as normal. For anything touching the live site:
schema → apply to Neon; env/secrets → set on Railway. Migration tooling is `drizzle-kit
push` (`npm run db:push`); there is no migrations folder. Pushing diffs the whole schema,
so for a single missing table prefer a surgical `CREATE TABLE` in Neon.
