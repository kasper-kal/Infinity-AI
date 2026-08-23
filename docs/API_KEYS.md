# infinity-ai — API Keys (no Freebuff Keys tab needed)

You have **two ways** to give infinity-ai its keys. Neither uses the Freebuff Keys tab.

---

## Option 1 — In-app (recommended, zero restart)

1. Open infinity-ai → **Settings → API Keys**
2. Paste each key in its row (OpenRouter, ElevenLabs, Tavily, Figma, …)
3. Keys are stored in infinity-ai's **own database** and applied **immediately** — no restart, no file editing.

The panel shows a green/red status dot for every integration so you can see at a glance what's configured.

---

## Option 2 — Plain file in the repo

Copy this template to `.env.local` at the repo root, fill it in, restart the preview.
The server loads repo-root `.env.local` first (wins), then `.env`.
Both files are **gitignored** — your secrets never get committed.

```
# ── Required ──────────────────────────────────────────────
# PostgreSQL (free: https://neon.tech)
DATABASE_URL=postgresql://user:password@host:5432/dbname

# ── LLM ──────────────────────────────────────────────────
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=            # optional, default openrouter/free
OPENAI_LLM_API_KEY=          # fallback LLM
OPENAI_LLM_MODEL=openai/gpt-oss-120b
OPENAI_LLM_BASE_URL=https://integrate.api.nvidia.com/v1

# ── Voice ────────────────────────────────────────────────
ELEVENLABS_API_KEY=sk_...

# ── Web search + fact-check ──────────────────────────────
TAVILY_API_KEY=tvly-...

# ── Design ───────────────────────────────────────────────
FIGMA_ACCESS_TOKEN=

# ── Weather ──────────────────────────────────────────────
# None needed — powered by Open-Meteo, free and no API key required.

# ── File storage (optional; local disk under data/ is the default) ──
# Separate Postgres DB for file metadata (falls back to DATABASE_URL if unset)
DATABASE_URL_FILES=
# Backblaze B2 S3-compatible Gallery storage (preferred when configured).
# The endpoint and region below match the supplied B2 bucket location.
B2_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
B2_REGION=eu-central-003
B2_KEY_ID=YOUR_BACKBLAZE_KEY_ID
B2_APPLICATION_KEY=YOUR_BACKBLAZE_APPLICATION_KEY
B2_BUCKET_NAME=infinity-ai-Gallery
# Cloudflare R2 fallback (10 GB free, zero egress). Leave both cloud stores unset for local disk.
R2_ACCOUNT_ID=
R2_ACCESS_KEY=
R2_SECRET_KEY=
R2_BUCKET=

# ── Integrations (OAuth) ─────────────────────────────────
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
```

---

## What each key does

| Key | Purpose |
|---|---|
| `DATABASE_URL` | **Required.** Postgres — chat history, memory, settings, and the in-app keys themselves |
| `DATABASE_URL_FILES` | Optional. Separate Postgres for file metadata (defaults to `DATABASE_URL`) |
| `B2_KEY_ID` / `B2_APPLICATION_KEY` / `B2_BUCKET_NAME` | Optional. Backblaze B2 S3-compatible blob storage for Gallery; B2 uses `eu-central-003` and the configured endpoint by default |
| `B2_ENDPOINT` / `B2_REGION` | Optional B2 overrides; defaults to `https://s3.eu-central-003.backblazeb2.com` and `eu-central-003` |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY` / `R2_SECRET_KEY` / `R2_BUCKET` | Optional fallback. Cloudflare R2 blob storage; if no cloud keys are configured, blobs use local disk `data/files/` |
| `OPENROUTER_API_KEY` | Primary LLM — free auto-router, supports image vision |
| `OPENAI_LLM_API_KEY` | Fallback LLM (NVIDIA NIM gpt-oss-120b) |
| `ELEVENLABS_API_KEY` | Voice — text-to-speech (British male) |
| `TAVILY_API_KEY` | Web search + fact-checking |
| `FIGMA_ACCESS_TOKEN` | Design-to-code — real fonts/colors from Figma links |
| *(none)* | Weather widget uses Open-Meteo — free, no API key |
| `GMAIL_CLIENT_ID` / `_SECRET` | Calendar + email |
| `SPOTIFY_CLIENT_ID` / `_SECRET` | Spotify integration |

## How the in-app store works

- Keys live in the `app_secrets` table in infinity-ai's Postgres.
- At boot, the server injects them into `process.env` (DB values win over file values).
- Saving a key in-app applies it **immediately** — no restart needed.
- Secrets never leave the server: the UI only ever sees a masked preview (`sk-or-••••••••WXYZ`).
