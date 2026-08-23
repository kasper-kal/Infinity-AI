---
name: OAuth redirect URI stability
description: How to keep OAuth redirect URIs stable when Replit dev domains rotate.
---

## Rule

For OAuth flows (Google, etc.), never rely on `REPLIT_DEV_DOMAIN` as the sole redirect URI. Replit dev domains rotate between sessions, causing `redirect_uri_mismatch` errors.

**Why:** Google OAuth requires the redirect URI to match the registered URI exactly. A rotated domain breaks the match even if the app path is identical.

**How to apply:**

1. Set a stable `GOOGLE_REDIRECT_URI` environment variable (shared) pointing to the production URL or a fixed custom domain, e.g. `https://infinity-ai--kasperkal.replit.app/api/infinity-ai/gmail/callback`.
2. In the OAuth route handler, prefer `process.env.GOOGLE_REDIRECT_URI` over `REPLIT_DEV_DOMAIN` / `REPLIT_DOMAINS`.
3. Register that exact URI in the Google Cloud Console as an Authorized redirect URI.
4. Keep the production URI registered even when developing locally, so the same codebase works in both environments.