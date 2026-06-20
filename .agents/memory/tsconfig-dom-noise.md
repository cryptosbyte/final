---
name: TypeScript DOM-lib noise
description: Why tsc reports DOM errors that aren't real bugs in this repo.
---

Running `npx tsc -p tsconfig.json --noEmit` reports errors like:
`Cannot find name 'window'`, `Cannot find name 'DOMRect'`,
`Property 'getData'/'types'/'dropEffect' does not exist on type 'DataTransfer'`,
`Property 'key' does not exist on type 'KeyboardEvent'`, `Property 'focus' ... 'HTMLButtonElement'`.

**Why:** The root tsconfig's `lib` does not include `dom`. The actual client build runs
through Vite/esbuild, which provides DOM types, so these never break the running app.
There is no separate `client/tsconfig.json`.

**How to apply:** When typechecking client changes, ignore these DOM-lib errors — they are
pre-existing noise present on untouched files too. Only act on errors that reference your
new logic/types. Don't try to "fix" them by editing the files.
