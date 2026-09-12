# The "Good" Gate — 5-App Output Benchmark

The real bar for the fix campaign. The 5 live counters prove the *mechanism*
(that the loop runs and stops on quality); **this** benchmark proves the
*output* — whether a user actually gets a decent app.

One run = five real apps. Each is judged against its acceptance criteria
**with no hand-holding, no manual fixes**. A pass means all 5 apps meet all
criteria. A partial pass (3/5, or 5/5 with a hand fix) means the machine's
output isn't good yet — re-specify the weakest engine and re-run.

## How a run happens — two execution modes, same criteria

1. **api mode** — `driver.mjs --api` drives the real Build Studio API on a
   keyed host: `register → login → project → /build/scaffold →
   /build/execute-plan → /build/iterate → agent done+contract →
   screenshot-verification`. Needs `BASE_URL` + a reachable model on the host
   (free-tier is fine). This is the path the enabled production server takes.
2. **local-agent mode** — the agent itself (a vision-capable model in the
   workspace, e.g. Claude Code) performs the exact same loop directly in
   `out/<slug>/`: scaffold (write files) → assemble → see (screenshot) →
   fix → done (real `npm run build`, real browser). Zero API key required.
   This is how the campaign can actually be executed in an unkeyed sandbox —
   the loop is Claude Code's loop.

Every app lives isolated in `out/<slug>/`, has its own lifecycle in
`state.json`, is built with real tools, served locally, and screenshot-verified
with headless Chrome (`verify.mjs`: console errors + DOM assertions +
responsiveness + pixels). The verify verdict is the gate — not a self-report.

## The apps and their acceptance criteria (the bar)

| # | App | slug | Acceptance criteria (ALL must hold) |
|---|-----|------|--------------------------------------|
| 1 | SaaS landing page | `saas-landing` | Marketing sections render · responsive (320–1440px, no horizontal scroll) · nav links work · `npm run build` green · no dead links · no `[object Object]` anywhere |
| 2 | Todo app with persistence | `todo-persist` | Add / complete / delete / filter all work · state survives reload (localStorage) · empty-state renders · no console errors |
| 3 | Dashboard | `dashboard` | Data table + chart render REAL data · loading + empty states exist · filters work · responsive |
| 4 | Chat widget | `chat-widget` | Messages append both ways · scroll behavior sane (stays pinned to newest) · send button disabled on empty input · error state on failure |
| 5 | Markdown editor | `markdown-editor` | Live preview matches source · source/preview toggle works · unsaved-changes hint · `npm run build` green |

## App-agnostic checks every app must pass (verify.mjs generic suite)

- loads over HTTP with HTTP 200, no failed requests
- zero console errors / page errors while exercising the app
- viewport resize (320 · 768 · 1440px) never produces horizontal scroll
- screenshot captured — a real pixel artifact exists in `out/<slug>/screenshot.png`
- no `[object Object]` in the rendered text
- app-specific checks in `out/<slug>/verify.spec.mjs` (the acceptance criteria,
  exercised against the live DOM)

A check fails when `verify.mjs` observes reality disagreeing with the
criterion — same spirit as the campaign's `|| true` kill: the reporter can
only lose.

## State machine (per-app lifecycle, multi-agent ready)

```
pending → building → verifying → pass | fail
                                   ↳ (fail → fixing → building → …)
```

`state.json` owns the lifecycle. One or two executors may run apps in
parallel; each app is independent and reconciled by `driver.mjs local`.

## Cross-host / remote / local

`driver.mjs` accepts `--base-url`, `--api-key` (or cookie auth), and
`--prefix out/<dir>` so the same driver runs against any deployed host or a
local API server. Local-agent mode is host-agnostic by construction.