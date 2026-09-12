# 📊 The "Good" Gate — 5-App Output Benchmark Harness

The campaign's real quality gate. The 5 live counters prove the *mechanism*
(the loop runs, stops on quality, failures are real) — **this** harness proves
the *output*: do users actually get a decent app?

Five apps, each built through the exact loop the campaign exists to produce
(**scaffold → assemble → see → fix → done**), each judged by a verifier that
can only lose. Full spec: [`specs/5-apps.md`](specs/5-apps.md).

```
bench/
├── specs/5-apps.md      # the spec — apps + acceptance criteria (the bar)
├── verify.mjs           # THE VERIFIER — Chrome, console errors, DOM, responsive, screenshot
├── driver.mjs           # orchestrator: local (report) + --api (Build API) modes
├── cleanup.mjs          # reset a workspace after a leftover/aborted run
├── state.json           # per-app lifecycle {pending→building→verifying→pass|fail}
├── REPORT.md            # generated report — the gate's verdict
└── out/<slug>/          # one workspace per app: source, verify.json, screenshot.png
```

## Two execution modes, same bar

| Mode | Command | Who does the loop | Needs |
|------|---------|-------------------|-------|
| **local-agent** (default) | `node bench/verify.mjs bench/out/<slug>` then `node bench/driver.mjs local` | a vision-capable agent in the workspace (Claude Code) — the campaign's "the loop is Claude Code's loop" | nothing (no API key) |
| **api** | `node bench/driver.mjs --api --base-url http://host:3000 --email <e> --password '<p>'` | the Build Studio API's own agent (scaffold→execute-plan→iterate→done contract) | a keyed host with a reachable model (free-tier ok) |

## The five apps (acceptance criteria in specs/5-apps.md)

`saas-landing` · `todo-persist` · `dashboard` · `chat-widget` · `markdown-editor`

A slate passes only when **all 5 apps pass all their criteria with no human
coded fix**. Partial = re-spec the weakest engine and re-run — not a new phase.

## Local-agent run (this campaign's executable path)

```bash
# 1. build an app (agent writes the real files; two apps also `npm run build`)
#    → the app lives in bench/out/<slug>/
# 2. judge it — the verifier is the gate:
node bench/verify.mjs bench/out/saas-landing     # exit 0 iff every check passes
node bench/verify.mjs bench/out/todo-persist
npm run build --prefix bench/out/markdown-editor # build-green apps first
# 3. reconcile state + render the report:
node bench/driver.mjs local
```

`verify.mjs` runs a generic suite on every app (HTTP 200, zero console/page
errors, no failed requests, no horizontal scroll at 320/768/1440px, no
`[object Object]`, real screenshot) **plus** the app's own acceptance criteria
from its `verify.spec.mjs`. A check fails when the browser observes reality
disagreeing with the criterion — the reporter can only lose (`|| true` kills
live in the audit; this instrument is the successor).

## Leftover-run hygiene / multi-agent state

`cleanup.mjs` resets a workspace after an aborted build (unsatisfied deps,
stale checkpoints, orphan screenshots) so a re-run measures a fresh build.
`state.json` owns each app's lifecycle and is written by `driver.mjs local`,
so one or two executors can build apps in parallel and the report reconciles
whatever landed. `--prefix out/<dir>` / `--base-url` / `--api-key` keep the
same driver portable across remote/local host deployments.

## 0-euro constraint

Everything here is local and open-source: plain HTML/CSS/JS apps, esbuild
(already in the monorepo) for the two bundle-green apps, and headless Chrome
(installed in Phase H) for vision verification. No service, API, or hosting
costs a cent — permanently.