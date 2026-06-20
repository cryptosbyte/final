---
name: Hosting & production database
description: Where this app is hosted and how production DB changes are applied.
---

The revision tracker (zakir.today) is hosted on **Railway**, not Replit Deployments.

**Why:** It changes how production fixes ship. A missing prod table (e.g. `gmail_tokens`)
or any schema change is applied via Railway's deploy/migration flow, NOT by calling
`suggest_deploy` / Replit publish.

**How to apply:** Do dev work in Replit as normal, but for anything touching the live
site or prod DB, point the user at their Railway deploy/migration process. Do not assume
Replit publishing affects production.
