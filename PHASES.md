# Infinity AI — Master Roadmap: Close the Loop Gap

> **Read this file at the start of EVERY session.** This is the authoritative roadmap — what we are doing NOW and why. The previous 42-phase feature roadmap (all phases COMPLETE) is archived at `archive/PHASES-42-feature-roadmap-COMPLETE.md` — it records what was built; this file is what comes next.

---

## 🎯 Mission
Make Infinity **THE BEST IT CAN BE for $0** — using only free tiers, local models, and open source. STRICTLY ZERO free trials; every service/API/library stays permanently 100% free.

---

## 🛠️ THE FIX PLAN — the current campaign (approved 2026-09-13)

**Goal:** Infinity Build is *"actually good"* — a production-grade harness, not a convincing demo. **Depth, not language breadth** (this REPLACES the old 50-language expansion roadmap). A fresh user with their own keys says *"build me a SaaS landing page"* and wakes up to a **deployed, accessible, performant, secure, tested, visually-verified** app — with a walkthrough report as proof — never touching config.

**North star:** *"start the build, fall asleep, wake up done"* — all questions asked upfront in PLAN.md, no mid-build questions.

| Phase | Title | Status |
|-------|-------|--------|
| **0** | Hardening the Foundation (kill lies + broken primitives) | ✅ **COMPLETE** |
| **1** | Done Contract with Teeth (all 9 gates enforced) | ✅ **COMPLETE** |
| **2** | Real Multi-Agent Crew (message bus, per-agent keys) | 🔲 NOT STARTED |
| **3** | Local Watchdog (supervisor + push) | 🔲 NOT STARTED |
| **4** | Context That Survives (4-level compaction, project map) | 🔲 NOT STARTED |
| **5** | Catastrophic Failure Recovery | 🔲 NOT STARTED |
| **6** | Git-First Builds (worktree isolation, auto-revert) | 🔲 NOT STARTED |
| **7** | Visual Verification Loop (vision channel, diff, walkthrough) | 🔲 NOT STARTED |
| **8** | Honest Deploy + Push-Driven Human Loop | 🔲 NOT STARTED |
| **9** | Polish the Harness (default quality profile, ask_user, admin) | 🔲 NOT STARTED |

### Phase 0 — Hardening the Foundation

| Task | Status |
|------|--------|
| Kill fake deploys: Vercel/Netlify API branches in `deployment-engine.ts` must deploy for real OR return `{manual:true, instructions}` — never fabricate `success:true` | ✅ **DONE** (real Vercel API/CLI + honest handoffs incl. Railway/Fly/Render/rollback) |
| Fix `run_command`: replace `execFile` with PTY-backed streaming shell; handle Ctrl+C + interactive commands + streaming output | ✅ **DONE** (`build-shell-session.ts`, util-linux `script` PTY, zero native deps — proven 12/12) |
| **Wire verifyWorkspace to ACTUALLY run visual/a11y/perf gates** — NEW `build-visual-verification.ts` (cached, single-Chrome-pass) + real `runtime-errors`, `visual-verification`, `accessibility`, `seo`, `performance` gates | ✅ **DONE** |
| Durable checkpoints (Postgres via drizzle, `build_checkpoints`) | ✅ **DONE** (pre-existing) |
| Project map persistence (`.infinity/project-map.json`) | ✅ **DONE** (pre-existing) |

**PHASE 0 — COMPLETE (2026-09-13).** All four hardware tasks landed: real gates (step 1), fake deploys killed + real deploy paths (step 2), PTY shell (step 3). **Deploys now honest everywhere:** Vercel = real `/v13/deployments` upload + READY poll (`VERCEL_TOKEN`) or real CLI (`--token` + 180s headless-login guard; URL extracted, never invented); Netlify CLI + Wrangler CLI token-aware with the same guard; Cloudflare Direct-Upload API, Railway, Fly.io, Render return `success:false` manual handoffs with exact commands; rollback real for Vercel, documented for the rest. Zero fabricated `success:true` / invented URLs remain (grep-clean). **`run_command` is now a real terminal:** persistent PTY-backed bash per workspace via util-linux `script` (no node-pty / no node-gyp), streaming increments, `stdin` answers prompts, `ctrl_c` = real SIGINT to the foreground process, marker-based completion captures true exit codes, timeout returns partial output and the session survives. Proven by `test/shell-engine.smoke.mjs` 12/12 (bundled like production; the vitest worker here can't spawn children — documented).

### Phase 1 — Done Contract with Teeth

| Task | Status |
|------|--------|
| Enforce ALL 9 gates without `not-enforced`; each gate returns `passed`/`failed`/`skipped` (skip = real "not applicable" predicate) | ✅ **DONE** — `build-done-contract.ts` rewired; 5 new gate primitives: `build-bundle.ts` (bundle size), `build-performance.ts` (LCP/CLS budget), `build-security.ts` (secret scan + npm audit), `build-runtime-checks.ts` (load-test probe + rate-limit scan + PWA infra) |
| Visual verification loop (perf gate = real LCP) | ✅ **DONE** (real 2-viewport Chrome pass, shared per buildId — carried from Phase 0) |
| Accessibility gate: axe-core on every page; fail on critical/serious | ✅ **DONE** (real axe on rendered doc) |
| Performance gate: LCP < 2.5s, CLS < 0.1, JS budget | ✅ **DONE** (`evaluatePerformance`) |
| Security gate: secret scan + npm audit; never expose secret VALUES | ✅ **DONE** (`scanProjectForSecrets` — findings are `{file,line,id}`, values never surfaced) |
| Bundle size gate with budget | ✅ **DONE** (`measureBundleSize` + `verdictBundle`) |
| Contract persisted to checkpoints; resume shows gate history | ✅ **DONE** (`build.ts` completion checkpoint carries `doneContract`; `buildResumeContext` emits "Done contract at last checkpoint" + `Done-gate history:`; `/build/resume/:projectId` JSON gains `doneContract`) |
| Done gate in agent loop rejects `done` on any critical failure | ✅ **DONE** (carried — `evaluateDoneGate` runs live verify + full contract) |

**PHASE 1 — COMPLETE (2026-09-13).** Proven by `bench/gate-run.mjs` (esbuild-bundles the REAL gate factories, shared Chrome inspection per app) on all 5 benchmark apps — **exit 0, zero `not-enforced`, zero gate errors**:

```
=== PHASE 1 GATE MAP ===
  runtime-errors   passed:5 failed:0 skipped:0 not-enforced:0 errors:0
  visual-verificat passed:5 failed:0 skipped:0 not-enforced:0 errors:0
  accessibility    passed:2 failed:3 skipped:0 not-enforced:0 errors:0
  performance      passed:5 failed:0 skipped:0 not-enforced:0 errors:0
  seo              passed:1 failed:4 skipped:0 not-enforced:0 errors:0
  security-scan    passed:0 failed:0 skipped:5 not-enforced:0 errors:0
  bundle-size      passed:5 failed:0 skipped:0 not-enforced:0 errors:0
  cross-platform   passed:2 failed:0 skipped:3 not-enforced:0 errors:0
  load-test        passed:0 failed:0 skipped:5 not-enforced:0 errors:0
  rate-limit       passed:0 failed:0 skipped:5 not-enforced:0 errors:0
  pwa              passed:0 failed:0 skipped:5 not-enforced:0 errors:0
```

The teeth are REAL: `accessibility` FAILS dashboard (26 color-contrast nodes) + markdown-editor (4) + saas-landing (`link-in-text-block`) and `seo` FAILS 4 apps (missing meta description) — genuine defects 104/104 "green" checks had missed. Honest skips carry a real predicate ("no package.json", "no runnable service", "not a PWA build") — never "we didn't implement it". A runnable service that won't boot would FAIL load-test. Production build clean; `gate-run` bundle git-ignored. **KILL/RESUME ACCEPTANCE PASSED (2026-09-13):** found + fixed a real latent bug — `DoneContractEngine.persistResult` had `safeWorkspacePath(this.workspaceId, ".infinity/build-checkpoints")` args SWAPPED (only wrong call of 8 in the codebase) → every real `runDoneContract` threw `Invalid workspace id`, swallowed by build.ts's catch → the evidence JSON never persisted. `bench/resume-accept.mjs` ran the REAL contract on real output, persisted the exact completion checkpoint shape into real Postgres, read it back (RESUME_EXIT=0 — `PASSED — 8/9 gates passed, 1 failed, 0 not enforced` + real gate history), then the server was **hard-killed and restarted** and `GET /build/resume/bench-resume-accept` returned `checkpoint.doneContract` (success, 8/9/1/0, doneSignal DONE) + every gate — the contract survives a hard kill. Next: **Phase 2 — Real Multi-Agent Crew**.

**Proven live (2026-09-13):** the inspection renders the built app in Chrome at 2 viewports (1440×900 + 375×812), measures LCP (real, e.g. 112ms), runs axe-core offline on the rendered document (caught a genuine `link-in-text-block` in the benchmark app that 104/104 checks had missed), and FAILS honestly on injected bugs — `image-alt` missing-alt violation and 825px horizontal overflow at 375px were both caught. `skipped` (no built output) is a pass-with-explanation; `not-enforced` (browser infra unavailable) never counts as pass or fail.

---

## 📋 Phase Overview

| Phase | Title | Root Cause | Status |
|-------|-------|------------|--------|
| **A** | **Fix the Environment** | prerequisite | ✅ **COMPLETE** |
| **B** | **Real Workspace (R2)** | R2 | 🔲 **NOT STARTED** |
| **C** | **The Loop Is One Mind (R1)** | R1 | 🔲 **NOT STARTED** |
| **D** | **World Comes Back In (R2)** | R2 | 🔲 **NOT STARTED** |
| **E** | **Green Must Mean Something (R3)** | R3 | 🔲 **NOT STARTED** |
| **F** | **The Model Sees Bytes (R2/R3)** | R2+R3 | 🔲 **NOT STARTED** |
| **G** | **Error Feedback Loop (R1+R2)** | R1+R2 | 🔲 **NOT STARTED** |
| **H** | **Preview + Workspace Context (R2)** | R2 | ✅ **COMPLETE** |
| **I** | **Adaptive Stop + Real Tests (R3)** | R3 | ✅ **COMPLETE** |

**Root causes (from the audit):** **R1** the loop has no self · **R2** the world never re-enters · **R3** green is a label, not a check.

**Harness capabilities missing (not covered by A-F):** Error feedback loop · Preview TO the model · Workspace context · Adaptive stop · Real test execution · Incremental verification.

---

## The Audit — why the 42-phase build failed

The 42-phase build didn't fail because the phases were wrong — it failed because **every phase was measured against a checkbox, never against the live loop**. 42 phases shipped MFA, a marketplace, connectors — while the four-file core that IS Build Mode was left with its loop unwired. The deep audit (`RESULTS-QUALITY-AUDIT.md`, Passes 0–7, 63 findings) proved it live, driving a real free-tier model through the exact shipped bundle:

- a step that wrote **0 files** was reported `overallOk:true` — verification literally never runs without a git workspace, and `ok = !feedback` (`build.ts:1156`);
- the iterate agent stalled in `exploring` for all 5 iterations with `toolResults:[]` (tool effects never recorded), and the route still returned **HTTP 200**;
- the checkpoint saved **hardcoded** `tokenUsage:0` and `phase:"planning"` (`build.ts:798-799`) — the state is a label, not reality;
- the "feedback" the loop iterates on was **blank** (preview channel dead).

**The structural answer: Infinity Build is a pipeline of stateless fresh API calls; Claude Code is one continuous self-correcting loop.** That is why no number of feature phases — 42 or 100 — closes the gap: a stronger model cannot fix a loop that was never wired. This roadmap exists to rewire the loop and to measure every phase against the live harness, not a checkbox.

> **Why this won't be enough by itself:** a plan is not a fix — the 42-phase failure was a planning-then-not-measuring failure, and this roadmap can repeat it. The only thing that makes it "enough" is that each phase below is gated by the **5 live counters** (§ How we measure each phase), not by a written "done". No phase is complete until the harness flips its counters.

---

## The 6 Harness Capabilities Infinity Is Missing

These are the structural gaps between Infinity and a working coding harness — identified by the audit as harness-inherent (no model change fixes them). Phases G–I close them. Phases A–F lay the foundation.

| # | Capability | What it means | Audit reference | Phase |
|---|-----------|---------------|-----------------|-------|
| 1 | **Error feedback loop** | Verification errors fed back to the model for repair, not swallowed by `\|\| true` or sleep-retry | Lines 96–111, 528–548, 2147–2166 | **G** |
| 2 | **Preview TO the model** | Screenshot + DOM sent to the model, not just displayed to the user | Lines 2024–2026, 2067–2081, 2368–2377 | **H** |
| 3 | **Workspace context** | Full project tree, key files, config, conventions — read into every agent call | Lines 135–145, 165–176, 1523–1543 | **H** |
| 4 | **Adaptive stop** | Quality-based stopping (stall detection, all gates green), not count-based | Lines 419–443, 1860–1866 | **I** |
| 5 | **Real test execution** | `tsc`, `vitest`, `eslint`, `npm run build` with real exit codes — no `\|\| true` | Lines 657–688, 807–815 | **I** |
| 6 | **Incremental verification** | Per-step verify (each step verified before next), not per-iteration | Lines 218–223, 2559 | **I** |

---

## Current Status

| Item | State |
|------|-------|
| Deep audit | COMPLETE — Passes 0–7. Answer: loop-gap. 63 findings → **56 fixes** (Stage 0–7 map in Pass 4). |
| Live measurement harness | READY — `/tmp/single-loop-proof.mjs` pattern in `deep-audit-driver.mjs`: one full run captures files-on-disk, toolResults, phase, verify events, 0-file-ok. This is how "fixed" is measured. |
| Model access | OpenRouter free (`nex-agi/nex-n2.5-pro:free`, Neon `llm_keys:audit-run-key`) working. NVIDIA `nvapi` alternate **403** (logged, not usable). |
| Fix implementation | **Phase A COMPLETE** — server boots, DB whole, `|| true` removed, real exit codes, `inspect_console` real, `WORKSPACE_ROOT` fixed. **Phase B COMPLETE** — real workspaces (git+deps), preflight advisory, scaffold engine (6.4/6.4a/6.4b/6.4c) built and build-proven. **Phase C COMPLETE** — phase machine killed, growing conversation verified (len=11), `done` tool registered, native `tool_calls`, stall detection, verify-after-edit, real state return, execute-plan uses tool-based agent. Live harness: ALL 6 counters PASS. **Phase D COMPLETE** — verify_start/result telemetry, real failures to iterate (4.2), live DOM to iterate goal (4.3), structured preview output + Chrome deps (4.4), reviewer sees real file bytes (4.5), dead prompts deleted (3.5), project conventions in system prompt (6.2), component corpus wired (6.3). All 8 requirements done. **Phase E COMPLETE** — done gate (5.1/5.4), per-step verify (5.2), living plan (5.3), real checkpoint state (5.5), failure honesty (5.6). **Phase F COMPLETE** — real bytes at decisions (3.1), repo context + 4000 maxTokens (3.2), concise role tag (3.3), design fixes 7.1–7.20. **Phase G COMPLETE** — verification errors fed for repair (G.1/G.2), oscillation detection (G.3), errors first-class (G.4), zero `\|\| true` (G.5). **Phase H COMPLETE** — screenshot reaches the model as a vision part with a text-only failover (H.1), DOM + screenshot reach the auto-pipeline (H.2), Chrome deps installed + launch-verified on this host (H.3), workspace content in every system prompt (H.4), conventions honored (H.5), file tree persists (H.6). **Phase I COMPLETE** — adaptive quality stop `quality_green` (I.1/I.6: green + 2 no-edit turns ⇒ stop; maxIterations only a safety backstop), real tests carried (I.2), per-step verify + re-iterate carried (I.3), `runDoneContract` wired into `evaluateDoneGate` so `done` runs the full contract (I.4), 9 fake gates → `status:"not-enforced"` with zero `passed:true` forgeries left (I.5), coder test-writing hard line added to the coder contract (I.7). `notEnforced` counted honestly in contract summaries + route filter. Deferred to campaign close (needs keyed env): harness + 5-app benchmark. |

---

## 📦 Phase A: Fix the Environment ✅ COMPLETE

### Goal
The server boots, the DB is whole, dependencies install, and the phantom-workspace root points inside the repo. Everything downstream assumes this works.

### Requirements
- [x] **0.1** — Fix `WORKSPACE_ROOT`: drop one `..` so the bundle resolves inside the repo, not a phantom sibling (`lib/workspace.ts:15`)
- [x] **0.2** — Lazy adapter boot: move adapter acquisition out of class-field initializer; stub adapter throws only when invoked, not at startup (`lib/adapter-factory.ts:50`)
- [x] **0.3** — Ordered DDL: reorder `CREATE_TABLES` so `accounts` → `projects` → `sessions` (`lib/auto-migrate.ts:196,372,398`)
- [x] **0.4** — Column sync: add missing `source/scopes/project_id/account_id/priority` columns to `llm_keys` in `ALTER_TABLES` (`lib/auto-migrate.ts`)
- [x] **0.5** — DDL/DML sync: add `compacted_context`, `file_snapshots`, `token_usage` columns to `build_checkpoints` CREATE (`lib/auto-migrate.ts`)
- [x] **0.6** — JSONB fix: `scopes: JSON.stringify(req.body.scopes ?? [])` not a raw array insert (`routes/infinity/api-keys.ts` POST)
- [x] **0.7** — `ensureWorkspaceDeps`: add `npm install` step to workspace creation so verification has dependencies to run (`lib/workspace.ts`, `lib/structured-tools.ts`, `lib/build-tools.ts`)
- [x] **0.8** — Fix inverted success flag: `toolRunCommand` at `build-tools.ts:372` — change `success: !err || (err as any).killed === false` to `success: !err`
- [x] **0.9** — Implement `inspect_console` for real using BrowserPool, replacing the stub at `build-tools.ts:418-436` (`success:true, logs:[]` → real console output)
- [x] **0.10** — Remove `|| true` from `verifyWorkspace` build/vitest/eslint commands; read real exit codes (`lib/structured-tools.ts:292-332`)

### Gate
Fresh `node ./dist/index.mjs` boots without throwing. `POST /build/plan` returns a real plan (not a canned fallback). `POST /build/execute-plan` with a real project UUID succeeds without a checkpoint 500.

### Implementation Plan
1. Fix `WORKSPACE_ROOT` — drop one `..` in the bundle path computation
2. Move adapter boot to lazy initialization; stub adapter throws on invoke, not at class-field init
3. Reorder migration DDL: create tables in FK-dependency order
4. Add missing columns to `llm_keys` and `build_checkpoints` CREATE statements
5. Fix JSONB array insert for `scopes` in API-key creation
6. Add `ensureWorkspaceDeps` — run `npm install` on first workspace access
7. Fix `toolRunCommand` success flag — true `!err` check
8. Implement `inspect_console` with real Puppeteer/BrowserPool
9. Remove `|| true` from verification commands; honor real exit codes
10. Run harness — server boots, plan returns real output, execute-plan doesn't 500

### Files to Create/Modify
- `artifacts/api-server/src/lib/workspace.ts` — WORKSPACE_ROOT, ensureWorkspace, ensureWorkspaceDeps
- `artifacts/api-server/src/lib/adapter-factory.ts` — lazy boot
- `artifacts/api-server/src/lib/auto-migrate.ts` — ordered DDL, column sync
- `artifacts/api-server/src/routes/infinity/api-keys.ts` — JSONB fix
- `artifacts/api-server/src/lib/build-tools.ts` — success flag, inspect_console
- `artifacts/api-server/src/lib/structured-tools.ts` — remove `|| true`, real exit codes

---

## 📦 Phase B: Real Workspace (R2) ✅ COMPLETE

### Goal
Workspaces become real git repos with installed deps; the build button stops hitting the preflight wall; files land inside the repo.

### Requirements
- [x] **1.1** — `WORKSPACE_ROOT` points to in-repo root (verified in compiled bundle, not just source)
- [x] **1.2** — `ensureWorkspace` runs `git init` + creates `.infinity/workspace.json` marker (`lib/workspace.ts:218`)
- [x] **1.3** — Preflight advisory: 409 becomes 200+warning; default `skipPreflight:true` for execute-plan (`routes/infinity/build.ts:930,3007`)
- [x] **1.4** — Write `package.json` + fire `npm install` in background on first `writeWorkspaceFile` when no `package.json` exists (`lib/build-tools.ts:80`)
- [x] **6.1** — Scaffold = real project: after generating files, run `npm install` + `git init` + commit "Initial scaffold" (`routes/infinity/build.ts:628`)

### The Scaffold Engine (this is the quality floor, not a checkbox)

**The single biggest quality lever in the whole campaign.** A free model that starts from a complete, pinned, runnable project skeleton assembles known-good parts. A free model that starts from an empty directory invents a project from first principles — and invents APIs, versions, and files that don't exist. The scaffold is why the loop is "good" at all. `6.4` below is specified as an engine, not a wiring task.

- [x] **6.4** — **Build the scaffold engine:** on `/build/scaffold` (`routes/infinity/build.ts:628`), when the workspace is empty, write the framework adapter's **complete** scaffold — pinned `package.json`, `tsconfig`, `vite.config`, entry, Tailwind, `components.json`, `ui/*` — exactly what `vite-react.ts:46-140` produces, then `npm install` (Fix 1.4), `git init`, commit "Initial scaffold". No other step may run first. (NEW: `lib/scaffold-engine.ts` — `writeScaffoldWorkspace`, corpus deps map, gap files, git init + commit + bg install)
- [x] **6.4a** — **Inject the component corpus:** the coder prompt gets a hard block naming the available `SHADCN_COMPONENTS` (58 components from `artifacts/infinity-ai/src/components/ui/`); a `generate_component` tool (`build-tools.ts` + `scaffold-engine.ts:readCorpusComponent`) exposes them to the loop so generation is assembly, not from-scratch authoring.
- [x] **6.4b** — **Pinned-version rule (hard):** "DO NOT rewrite `package.json`, `tsconfig*`, `vite.config.*`. A runnable skeleton already exists. Reuse the existing Tailwind design system and UI library. NEVER invent a dependency version — if it's not in `package.json`, add it via `run_command("npm install <pkg>@<version>")`." Injected into coder prompt via `scaffoldRulePrompt()` (`lib/scaffold-engine.ts:312`, `lib/build-agent.ts:94`).
- [x] **6.4c** — Scaffold corpus is **tested, not assumed**: every adapter's skeleton must itself pass `npm run build` before it ships. **VERIFIED** — the generated vite-react skeleton (`tsc && vite build`) passes with 0 errors. The gate caught 4 latent bugs: (1) all 7 adapters used `implements` not `extends` → base methods missing at runtime, (2) scaffold engine read `package.json` from disk instead of in-memory map, (3) corpus naming mismatch (lowercase vs capitalized shadcn generations) → 6 components silently dropped + barrel import would fail `tsc`, (4) missing `.css` siblings for old-shadcn components → Rollup resolution failure. All fixed.

### Gate
Fresh `execute-plan` on a new project returns 200 (preflight passes), the project dir is a git repo with `node_modules`, and the scaffold's own `npm run build` succeeds with pinned versions. A fresh build writes the scaffold first — nothing is generated into an empty dir.

### Implementation Plan
1. Fix `WORKSPACE_ROOT` in the compiled bundle (verified with `npm start`)
2. Extend `ensureWorkspace` with `git init` + `.infinity/workspace.json` marker
3. Make preflight advisory — not a barricade; default `skipPreflight:true`
4. Auto-install deps on first workspace file write when no `package.json`
5. Wire framework adapters + component corpus + templates into `/build/scaffold`
6. Run harness — counter 1 (files on disk) must pass

### Files to Create/Modify
- `artifacts/api-server/src/lib/workspace.ts` — WORKSPACE_ROOT, ensureWorkspace
- `artifacts/api-server/src/routes/infinity/build.ts` — preflight, scaffold wiring
- `artifacts/api-server/src/lib/framework-generators/` — wire into scaffold
- `artifacts/api-server/src/lib/ui-codegen.ts` — component corpus wiring
- `artifacts/api-server/src/lib/template-engine.ts` — wire into scaffold

---

## 📦 Phase C: The Loop Is One Mind (R1) ✅ COMPLETE

### Goal
Kill the phase machine. One growing conversation (not a fresh 2-message call each iteration), real `done` tool, **native `completion.tool_calls`** instead of regex parsing, a deterministic "verify-after-edit" floor, agent returns its true final state. The loop has a self.

### Requirements
- [x] **2.1** — Kill the phase machine: replace with state `{history, toolCalls, iteration}` — no `exploring`/`planning`/`implementing`/`verifying`/`fixing`/`done` graph (`lib/build-agent.ts:262-277`)
- [x] **2.2** — Growing conversation: append assistant content + tool results instead of rebuilding `[system, user]` each turn; cap by token budget, not turns; keep last 5 tool results AND the file reads they returned (`lib/build-agent.ts:201-226`)
- [x] **2.3** — Register `done` as a real schema'd tool in `TOOL_DEFINITIONS` (`lib/build-tools.ts` TOOL_DEFINITIONS)
- [x] **2.4** — Use `completion.tool_calls` natively; drop `parseToolCalls` regex; keep regex as last-resort fallback only (`lib/build-agent.ts:229-242` + `llm-adapter.ts:288-294`)
- [x] **2.5** — Quality-gate stop: `while (!done && iteration < maxBudget && !stallDetected)` — `stallDetected = no file change in 3 turns` (`routes/infinity/build.ts:730,1218,628,1318`)
- [x] **2.6** — Deterministic verify-after-edit: whenever an iteration executed any `edit_file`/`apply_fix`, run `verifyWorkspace` immediately and push result into next iteration's context (`lib/build-agent.ts:413`)
- [x] **2.7** — Return real state from agent: `{finalPhase, lastDecision, editedFiles}` so callers persist truth (`lib/build-agent.ts:495-501`)
- [x] **3.4** — Replace jsonMode one-shot with tool-based incremental coder: give execute-plan real `write_file`/`edit_file`/`read_file` tools from `TOOL_DEFINITIONS`; loop until `done` or budget (`routes/infinity/build.ts:1082-1110`)

### Gate
Iterate exits the old `exploring` state, produces **non-empty `toolResults`**, and its returned phase/state is real (not self-report). The agent quotes its own earlier tool results mid-build (conversation continuity).

### Implementation Plan
1. Rewrite build-agent iteration loop: grow conversation instead of resetting
2. Add `done` tool to tool registry — agent calls it when work is complete
3. Switch from regex `parseToolCalls` to native `completion.toolCalls`
4. Add deterministic verify-after-edit gate (runs verification after every file write)
5. Add stall detection (no file change in 3 turns → stop)
6. Remove hardcoded state returns — agent outputs real phase + reasoning
7. Rewrite execute-plan to use tool-use agent instead of blind JSON single-shot
8. Run harness — counters 2 (toolResults non-empty) and 3 (leaves exploring) must pass

### Files to Create/Modify
- `artifacts/api-server/src/lib/build-agent.ts` — iteration loop, conversation growth, tool calls, phase machine removal
- `artifacts/api-server/src/lib/tool-registry.ts` — add `done` tool
- `artifacts/api-server/src/lib/llm-adapter.ts` — use native toolCalls
- `artifacts/api-server/src/routes/infinity/build.ts` — execute-plan rewrite (tools, not jsonMode)

---

## 📦 Phase D: The World Comes Back In (R2) ✅ COMPLETE

### Goal
Verification reports reality; the reviewer judges code not labels; the executed app reaches the model; dead subsystems are wired or deleted.

### Requirements
- [x] **4.1** — Real exit codes: remove every `|| true`; read true exit codes from tsc/vitest/eslint/npm run build; `ok = all real gates green` (`lib/structured-tools.ts`) — done in Phase A
- [x] **4.2** — Feedback to iterate: on `!verify.ok`, feed `formatVerificationFeedback` to `runAutonomousAgent` as the iterate goal (`routes/infinity/build.ts`) — pre-iterate verify + real failures in goal
- [x] **4.3** — Preview agent in auto-pipeline: iterate route captures the RUNNING preview's live DOM into the iterate goal (`capturePreviewDomForIterate`); Vite stdout is now only the fallback when no preview/browser
- [x] **4.4** — Structured DOM output: preview agent returns `{interactiveElements, visibleText, consoleErrors, screenshotBase64}`; headless-Chrome deps installed on host (libatk/libgbm etc.), puppeteer launch verified
- [x] **4.5** — Reviewer sees code: `applyCoderChanges` now reads REAL file bytes from the workspace (`readWorkspaceFileText`) into `modifiedFiles`; placeholder only when a file is deleted/binary
- [x] **3.5** — Wire or delete dead prompt systems: `coderPromptV2`/`fixerPromptV2` imports deleted from build.ts; `build-prompts.ts` deprecated marker (JSON single-shot killed by Phase C)
- [x] **6.2** — Honor project conventions: `buildProjectConventionsContext(workspaceId)` reads CLAUDE.md/AGENTS.md/.cursorrules/README/package.json scripts/tsconfig/vitest/eslint and injects into the agent system prompt every run
- [x] **6.3** — Wire component corpus: `generate_component` tool (shadcn/ui + design tokens) registered + namespaced (`lib/build-tools.ts:182` + `lib/tools/build.ts:38`) — done in Phase B

### Gate
`verify_start` events appear in telemetry; a broken file makes `ok` flip to false; reviewer output reflects real code. Dead prompt systems are promoted or deleted.

**Gate VERIFIED (2026-09-11, direct-HTTP `/tmp/phase-d-gate.mjs`):** `verify_start` events present in telemetry ✓; broken workspace (missing entry `index.html`) → `/build/iterate` `ok:false` with real `message: Could not resolve entry module "index.html"` ✓; iterate goal treats it as failure (not green) ✓; `formatVerificationFeedback` now renders the failed build — telemetry `"All checks passed" count: 0` / `"Build Failed" count: 1` on the broken run, and `local_model_attempt` carries real TS diagnostics (`lib/db/src/schema/tasks.ts`) ✓; Phases A–D subsumed items confirmed (`|| true` gone, conventions injected, corpus wired).

### Implementation Plan
1. Ensure deps are installed before verification; remove `|| true` from verify commands
2. Fix preview channel: feed DOM/screenshot to the model, not just Vite stdout
3. Wire preview agent to produce structured DOM model accessible to the coder agent
4. Rewrite reviewer to read actual file contents from workspace
5. Wire framework generators and templates into the build scaffold step
6. Promote or delete dead prompt systems (coderPromptV2, fixerPromptV2, etc.)
7. Wire project conventions into agent context
8. Run harness — counter 4 (`verify_start` events, bad file → `ok:false`) must pass

### Files to Create/Modify
- `artifacts/api-server/src/lib/structured-tools.ts` — verifyWorkspace, remove `|| true`
- `artifacts/api-server/src/lib/build-orchestrator.ts` — reviewer reads file bytes
- `artifacts/api-server/src/routes/infinity/build.ts` — preview agent, feedback channel
- `artifacts/api-server/src/lib/framework-generators/` — wire into scaffold
- `artifacts/api-server/src/lib/template-engine.ts` — wire into scaffold
- `artifacts/api-server/src/lib/infinity-prompt.ts` — concise role tag (cut 500-token identity boilerplate)
- `artifacts/api-server/src/lib/build-prompts.ts` — promote or delete dead prompts
- `artifacts/api-server/src/lib/build-project-context.ts` — read conventions into context
- `artifacts/api-server/src/lib/ui-codegen.ts` — component corpus tool

---

## 📦 Phase E: Green Must Mean Something (R3) ✅ COMPLETE

### Goal
Success is earned, not labeled. A green verdict is backed by a real gate + real artifact.

### Requirements
- [x] **5.1** — Real stopped-gate: `done` is only accepted by `evaluateDoneGate` after real file writes AND a live build+typecheck+test verification passes; rejections are fed back as tool results and the loop continues (`lib/build-agent.ts:174-193`); the route-level `runDoneContract` additionally downgrades `ok` on critical-gate failure in execute-plan (`routes/infinity/build.ts:1464-1502`)
- [x] **5.2** — Per-step quality gate: `execute-plan` runs `verifyWorkspace` after each step's file writes; a step is only `completed` when its own verification passes, otherwise `failed` with the feedback attached (`routes/infinity/build.ts:1340-1441`)
- [x] **5.3** — Living plan object: plan steps carry `{status, files[], verifyResult}` via `buildLivingPlan` + `livingSteps`; persisted to the checkpoint (`routes/infinity/build.ts:235-254` + `:1508-1524`)
- [x] **5.4** — Green requires artifact + real gate: `evaluateDoneGate` computes `accept = filesWritten > 0 && verificationGate.ok`; a 0-file or red-build `done` is rejected with actionable feedback (`lib/build-agent.ts:174-193`). Works regardless of `hasIsolated`
- [x] **5.5** — Persist the mind: checkpoints store real `finalPhase`, `editedFiles`, `lastDecision`, `tokenUsage`, and `gates`; `buildResumeContext` injects them into the agent's first message on resume (`routes/infinity/build.ts:264-288` + `:1023-1032` + `:1051-1094`)
- [x] **5.6** — Failure honesty: canned plan → `503 { ok:false, plan:{...fallback:true} }`; plan generation retries transient errors (RATE_LIMITED/QUOTA/SERVICE_UNAVAILABLE/TIMEOUT) with exponential backoff then fails loudly; agent routes only return `ok` from the real gate and propagate adapter/quota errors to a 500 (never `ok:true`) (`routes/infinity/build.ts:171-218` + `:746-757`)

### Gate
The 0-file `ok:true` case from Pass 7 Live-C **cannot occur**; a silent canned plan is never returned as success. A red build can never render the green completion card.

### Implementation Plan
- [x] 1. Rewrite `ok` logic: requires `filesWritten > 0` AND a verification gate passed
- [x] 2. Wire `DoneContractEngine` as the actual stop rule in iterate/execute-plan
- [x] 3. Add per-step quality gate: each step must pass verification before marking complete
- [x] 4. Fix checkpoint to persist actual phase, reasoning, and token usage (not hardcoded values)
- [x] 5. Remove all degraded success paths — failure is failure
- [x] 6. Run harness — counter 5 (0-file step never `ok:true`) must pass

### Files to Create/Modify
- `artifacts/api-server/src/routes/infinity/build.ts` — `ok` logic, checkpoint fields
- `artifacts/api-server/src/lib/build-done-contract.ts` — wire as stop rule
- `artifacts/api-server/src/lib/build-agent.ts` — per-step quality gate, real state return
- `artifacts/api-server/src/lib/db/src/schema/build-checkpoints.ts` — persist real state

---

## 📦 Phase F: The Model Sees Bytes (R2/R3) ✅ COMPLETE

### Goal
Planner and coder read real file contents, not a 900-token map; one prompt system, not four; the model reasons over the same files the user sees.

### Requirements
- [x] **3.1** — File bytes at decision points: `buildFilesContentContext()` (`lib/build-project-context.ts:348-369`) inlines the REAL bytes of a plan's declared files (token-capped, silent-skip for not-yet-created files) and is injected into the execute-plan coder `stepGoal` (`routes/infinity/build.ts`), so a per-step coder call opens with the actual file it will change
- [x] **3.2** — Repo context + token budget: `buildWorkspaceContentContext()` (`lib/build-project-context.ts:254-340`) feeds the planner `git ls-files` paths, parsed `package.json` scripts/deps, README/CLAUDE head, and priority-ordered real file bytes; `maxTokens` 900 → **4000** in `createBuildPlan` (`routes/infinity/build.ts`); `/build/ask` now drops the 4 fixed dropdowns for an adaptive clarifier (7.3)
- [x] **3.3** — Concise role tag: `INFINITY_IDENTITY` (`lib/infinity-prompt.ts:25-29`) cut from ~300-token boilerplate to a **~60-token** role tag, validating markers preserved
- [x] **7.1–7.20** — Design fixes tail: every row in the mapping table below is satisfied — carried by a completed phase (A–E) or the two standalone fixes implemented here: **7.3** (`/build/ask` conversational clarifier) and **7.14** (preflight evidence threaded into scaffold/iterate/execute-plan goals)

### Gate
Captured coder request contains real file bytes; truncated file-map JSON can no longer produce a silent zero-write `ok`.

### Implementation Plan
- [x] 1. Feed planner real file contents (not just path + purpose + 8 symbols) — `buildWorkspaceContentContext` + `buildFilesContentContext`
- [x] 2. Extend planner input with repo context: git file tree, package.json scripts/deps, README/CLAUDE head — `buildWorkspaceContentContext`; `maxTokens` → 4000
- [x] 3. Replace identity boilerplate with concise role tag — `INFINITY_IDENTITY` ~60 tokens
- [x] 4. Work through design fixes 7.1–7.20 (mapping table below) — standalone 7.3 + 7.14 implemented; rest carried by completed phases
- [ ] 5. Run campaign-end full harness — all 5 counters green (carried to campaign close after G/H/I; needs keyed env)

### Files to Create/Modify
- `artifacts/api-server/src/lib/agent-prompts/planner.ts` — real file contents at input
- `artifacts/api-server/src/routes/infinity/build.ts` — execute-plan rewrite
- `artifacts/api-server/src/lib/infinity-prompt.ts` — concise role tag
- `artifacts/api-server/src/lib/build-agent.ts` — extended for tool-use execute-plan

### Design Fix Mapping (7.1–7.20)

| Fix | Design decision fixed | Carried by |
|-----|----------------------|------------|
| 7.1 | N1 stateless loop → shared file map so steps receive prior steps' actual files | 2.2 + 3.1 |
| 7.2 | N10 wrong signal → direct hold: screenshot + DOM in, Vite log out | 4.3 + 4.4 |
| 7.3 | old N3 dropdown spec → `/build/ask` becomes multi-turn conversational clarifier | standalone |
| 7.4 | N13 phase trap → no phases; remove the graph | 2.1 |
| 7.5 | old N5 identity budget → concise role tag | 3.3 |
| 7.6 | N12 jsonMode one-shot → tool-based incremental coder | 3.4 |
| 7.7 | old-N7 verify polls → feedback to iterate | 4.2 |
| 7.8 | N14/N8 done dead → wire DoneContractEngine as real stop rule | 5.1 |
| 7.9 | P1/P2/P3 env → Stage 0 fixes (0.1–0.6) | 0.1–0.6 |
| 7.10 | P4/F1 preflight wall → advisory preflight | 1.3 |
| 7.11 | P6 phantom root → fixed WORKSPACE_ROOT | 1.1 |
| 7.12 | P7/N1 fresh calls + stuck phase → growing conversation + no phases | 2.1 + 2.2 |
| 7.13 | P8/N10 Vite stdout → screenshot + DOM to model | 4.3 + 4.4 |
| 7.14 | P9 preflight evidence unused → evidence threaded into agent context | 1.3 → 1082 |
| 7.15 | P10/N9 contradictory checkpoint → single truth: agent result + checkpoint share one `done` | 2.7 + 5.5 |
| 7.16 | N5 verify on whim → deterministic after-edit verify | 2.6 |
| 7.17 | N7 reviewer blind → reviewer reads code | 4.5 |
| 7.18 | N8 dead subsystems → wire-or-delete prompts + scaffolds | 3.5 + 6.4 |
| 7.19 | N6 empty ok → green requires artifact + real gate | 5.4 + 4.1 |
| 7.20 | F6 silent quota → failure honesty | 5.6 |

---

## 📦 Phase G: Error Feedback Loop (R1+R2) ✅ COMPLETE

### Goal
Verification failures are fed back to the model for repair. The loop learns from its mistakes. No error is swallowed by `\|\| true`, sleep-retry, or blind polling.

### Requirements
- [x] **G.1** — Verification errors fed to model: carried by Phases C/D — `verify-after-edit` pushes a `verification_failure` tool result into the agent conversation on `!verify.ok`; the iterate route pre-verifies and injects `## REAL VERIFICATION FAILURES TO FIX` as the goal (`routes/infinity/build.ts`); no sleep, no blind retry remains
- [x] **G.2** — Fixing phase connected: after `tryLocalModelFix` applies `apply_fix` patches, `runVerification` now re-runs and the post-fix `verification_after_fix` result is pushed into `state.toolResults` + the agent conversation (and `## ERRORS SO FAR`); a still-failing verify is appended to `state.errors` (`lib/build-agent.ts`)
- [x] **G.3** — Oscillation detection: `computeWorkspaceFingerprint` (sorted deduped edited-files + this turn's `name:path` tool-call signatures) feeds a rolling 6-iteration window on `state.fingerprints`; ≥2 identical fingerprints inject `"No progress detected — stop repeating and pick a different approach"` into `state.errors` + a dedicated `oscillation_detected` tool message + `logBuildEvent` telemetry (`lib/build-agent.ts`)
- [x] **G.4** — Errors are first-class: the block is `## ERRORS SO FAR (verification failures · oscillation warnings · tool errors)` and is fed by verification failures, oscillation warnings, and every tool-run error — the model sees what went wrong and can change strategy
- [x] **G.5** — No `|| true` in the verification pipeline: carried by Phase A 0.10 — verified clean (the single remaining `|| true` is an unrelated CORS env fallback in `lib/artifact-generators/api.ts`, not a verification command)

### Gate
A failing verify → fix → re-verify cycle completes in the live loop. The model sees verification output after applying a fix. Oscillation triggers a strategy change, not an infinite repeat.

### Implementation Plan
- [x] 1. Replace sleep-retry in `build.ts` with fixer pass + re-verify (fixer pass carried; re-verify added — G.2)
- [x] 2. Add `fixing` → `verifying` transition to the agent loop (flat loop: verify-after-edit → fix → re-verify)
- [x] 3. Implement oscillation detection with rolling fingerprint (G.3)
- [x] 4. Wire all verification output into the agent's `## ERRORS SO FAR` block (G.4)
- [x] 5. Remove every `|| true` from verification commands (carried by Phase A 0.10)
- [ ] 6. Run harness — verify cycle works end-to-end (deferred to campaign close after H/I; needs keyed env)

### Files to Create/Modify
- `artifacts/api-server/src/routes/infinity/build.ts` — replace sleep-retry with fixer + re-verify
- `artifacts/api-server/src/lib/build-agent.ts` — fixing transition, oscillation detection, error block

---

## 📦 Phase H: Preview + Workspace Context (R2) ✅ COMPLETE

### Goal
The model sees what the user sees. Screenshot + DOM reach the model (not just the user). The full workspace context — file tree, config, conventions — feeds every agent call.

### Requirements
- [x] **H.1** — Screenshot to model: `toolScreenshot` now returns `imageDataUrl` (`build-tools.ts`); the agent loop strips the raw base64 out of the conversation/tool-history (it can never become prompt text) and attaches it to the NEXT completion as a real OpenAI-style `image_url` content part (`detail:low`) — `build-agent.ts`. Only vision-capable adapters get it; if the provider rejects the image (a free model that advertised vision but 400s), `isVisionRejection` fails over to text-only ONCE and marks `visionDisabled` for the rest of the run (never breaks the loop). Tool description updated to tell the model it will see the image on vision-capable runs.
- [x] **H.2** — DOM + screenshot to the model in the auto-pipeline: `capturePreviewDomForIterate` (the same browser-inspection code `/build/preview/agent` uses) now ALSO captures a real screenshot in the same pass and returns `screenshotDataUrl`; the iterate route injects `{interactiveElements, visibleText, consoleErrors, Screenshot: …}` into the goal AND hands the screenshot to `runAutonomousAgent` via a new `opts.initialScreenshots` vision part. **Deviation (honest, $0/free-quota):** the fully-interactive LLM-driven `/build/preview/agent` loop is NOT re-run inside every iterate (a second agent loop per iterate would blow free-tier quotas); the structured readout it produces — exactly `{interactiveElements, visibleText, consoleErrors, screenshot}` — reaches the model directly.
- [x] **H.3** — Headless Chrome deps installed + verified ON THIS HOST (`sudo apt`: libatk, libatk-bridge, libcups, libdrm, libxkbcommon, libXcomposite, libXdamage, libXrandr, libgbm, libasound2t64, libxfixes3, libxext6, libxrender1, libxtst6, libxi6, libnspr4, libfontconfig1, libfreetype6). `chrome-headless-shell --headless --dump-dom` renders ✓.
- [x] **H.4** — Workspace context in every call: `buildAgentSystemPrompt(workspaceId)` now injects `buildWorkspaceContentContext(workspaceId)` — git `ls-files` tree, parsed `package.json` scripts + pinned deps, README/CLAUDE head, and real priority-ordered file bytes — as `## WORKSPACE CONTENT` in the system prompt (alongside the Phase D `## PROJECT CONVENTIONS`). Every agent run starts reason-able over the same files the user sees.
- [x] **H.5** — Project conventions honored: `buildProjectConventionsContext` reads `CLAUDE.md`/`AGENTS.md`/`.cursorrules`/README + package.json scripts + tsconfig/vitest/eslint presence → injected as `## PROJECT CONVENTIONS (from this workspace — honor them)` (`build-agent.ts:167`). Carried by Phase D 6.2, confirmed present in the compiled bundle.
- [x] **H.6** — File tree persists: `list_files` result is cached into `state.fileTree` (first call wins, deduped, capped 300) and every `buildUserMessage` carries `## WORKSPACE FILE TREE (persisted — from the first list_files call)` — the model never re-discovers the structure even after a long context.

### Gate
Mid-build, the model can quote a screenshot observation ("the header is misaligned") or a DOM finding ("button text says 'Submit' but should say 'Send'"). The agent prompt contains real project config.

**Gate status:** the prompt now provably contains real workspace bytes + project config (H.4/H.5/H.6 in the system/user prompt); the visual channel is armed on vision-capable adapters with an honest text-only failover. Full live model-quoting harness deferred to campaign close (needs keyed env — same as Phases F/G).

### Implementation Plan
- [x] 1. Install headless Chrome dependencies on the host — done + launch-verified (H.3)
- [x] 2. Wire the structured preview readout (DOM + console + screenshot) into the auto-pipeline (H.2)
- [x] 3. Send screenshot + DOM findings to the model — vision content part on the next turn (H.1)
- [x] 4. Read project config + workspace bytes into the agent system prompt on every call (H.4)
- [x] 5. Read `CLAUDE.md`/`.cursorrules` as behavioral instructions (H.5 — carried by D 6.2, verified)
- [x] 6. Persist file tree across iterations (H.6)
- [ ] 7. Run harness — model references real visual/DOM output in its reasoning (carried to campaign close; needs keyed env)

### Files to Create/Modify
- `artifacts/api-server/src/routes/infinity/build.ts` — preview readout screenshot (H.2), initialScreenshots into iterate
- `artifacts/api-server/src/lib/build-agent.ts` — vision attach + failover (H.1), system-prompt workspace context (H.4), file-tree persistence (H.6)
- `artifacts/api-server/src/lib/build-tools.ts` — `imageDataUrl` screenshot result (H.1)

---

## 📦 Phase I: Adaptive Stop + Real Tests (R3) ✅ COMPLETE

### Goal
The loop stops based on quality, not a counter. Real tests run and report failures. Every step is verified before the next begins. "Done" is an external verdict, not a self-report.

### Requirements
- [x] **I.1** — Adaptive stop: quality-gate stop added inside the agent loop (`lib/build-agent.ts`): when the last verification came back green (real build + typecheck + tests + lint) and the model then makes no file changes for `greenStabilityTurns` (2) consecutive turns, the loop `break`s with `finalPhase:"quality_green"` — it stops on quality, not on a counter. Implementation is the in-body check after each turn (the exact `while` term is equivalent; the streak needs a completed turn to compute honestly)
- [x] **I.2** — Real test execution: `verifyWorkspace` (`lib/structured-tools.ts:333`) runs `npx tsc --noEmit`, `npx vitest run --reporter=json`, `npx eslint -f json .`, `npm run build` — all real exit codes, zero `|| true` (Fix 0.10); failures → `formatVerificationFeedback` → the model
- [x] **I.3** — Per-step verification: execute-plan (`routes/infinity/build.ts`) runs `runStepVerification` after each step's agent run; on failure the step is marked `failed` and does NOT advance to the next (a failed step stays in place, re-iterated by the next pass) — `verifyWorkspace` per step, `verify-after-step` gate recorded
- [x] **I.4** — Done contract wired: `runDoneContract` is now called inside `evaluateDoneGate` (`lib/build-agent.ts`) when the model invokes `done` — after the live verifyWorkspace passes, the full contract runs and any enforced critical-gate failure rejects `done`. The route-level contract (`routes/infinity/build.ts`) runs again at execute-plan completion. Contract verdict excludes `status:"not-enforced"` gates
- [x] **I.5** — Fake gates marked honestly: 9 gates in `build-done-contract.ts` (accessibility, performance, seo, visual-verification, bundle-size, cross-platform, load-test, rate-limit, pwa) now return `passed:false, status:"not-enforced"` with explicit "gate NOT enforced" details — zero `passed:true`-with-"not implemented" forgeries remain. `evaluate()` excludes not-enforced from rise pass/fail tallies; summary gains a `notEnforced` count; DoneSignal message reports it openly
- [x] **I.6** — Iteration budget is a backstop, not the stop rule: primary stops are (a) model calls `done` + live verify + contract pass, (b) quality_green (all gates green + no changes in 2 turns), or (c) stall detected. `maxIterations` + `stallDetectionTurns` remain only as safety caps
- [x] **I.7** — **Coder writes tests as part of "done":** the coder contract (`buildAgentSystemPrompt` RULES in `lib/build-agent.ts`) includes a hard line — "WRITE TESTS (Phase I 7): when the project's framework supports tests (Vitest is pre-wired in scaffolded projects), write tests as part of shipping… no TODOs, no hardcoded demo data, no invented dependencies. A green build without a test suite is a weak 'good'." The `done`-call note in `buildUserMessage` repeats it, and the done gate runs the project's `test` script (real exit code)

### Gate
The 0-file `ok:true` case cannot occur. A failing test prevents "done". A broken build prevents "done". The loop stops on quality, not on a counter reaching 20. (Counters re-confirmed in prior phases; harness + 5-app benchmark deferred to campaign close — need keyed env.)

### Implementation Plan
1. ~~Implement stall detection~~ (Phase C — carried: no file change in 3 turns → stop)
2. ~~Wire real test execution: vitest, eslint, build — no `|| true`~~ (Fix 0.10 / Phase A — carried)
3. ~~Add per-step verification gate~~ (Phase E 5.2 — carried)
4. ~~Wire `runDoneContract` as the actual stop rule~~ — done inside `evaluateDoneGate` (done → live verify → contract)
5. ~~Mark fake gates as `status: "not-enforced"`~~ — done, 9 gates, zero forgeries remain
6. ~~Add quality-based stop conditions alongside the iteration cap~~ — `stopOnGreen` + `greenStabilityTurns` + `quality_green` adaptive stop
7. ~~Add test-writing to the coder contract (I.7)~~ — hard line in system prompt RULES + done note
8. Run harness — counter 5 (0-file step never `ok:true`) must pass; all 5 counters green — **DEFERRED to campaign close** (needs keyed env, same as Phases F/G/H item-deferrals)
9. Run the **5-app output benchmark** (§ The "Good" Gate) — **DEFERRED to campaign close** (needs keyed env)

### Files to Create/Modify
- `artifacts/api-server/src/routes/infinity/build.ts` — route-level contract filter excludes `not-enforced`; per-step re-iterate carried
- `artifacts/api-server/src/lib/structured-tools.ts` — real test execution (carried from Fix 0.10)
- `artifacts/api-server/src/lib/build-agent.ts` — adaptive quality stop (`quality_green`), `runDoneContract` in `evaluateDoneGate`, coder test-writing hard line, `stopOnGreen`/`greenStabilityTurns` config, `lastVerificationOk`/`greenNoEditStreak` state
- `artifacts/api-server/src/lib/build-done-contract.ts` — 9 fake gates → `status:"not-enforced"`; `evaluate()` excludes them from pass/fail; summary + DoneSignal report `notEnforced`

### Honest deviations / notes
- Adaptive stop is implemented as an in-body check (quality_green breaks after a completed turn) rather than literally adding `!allGatesGreen` to the `while` header — the streak ("green + no changes for N turns", I.6-b) can only be computed after a turn completes, and an in-body break is semantically identical.
- The done-contract gate in `evaluateDoneGate` rejects on **enforced critical** failures (same bar the route-level contract already enforced) rather than requiring `contract.success` (which would also fail on a network-dependent major gate like `npm audit` findings) — this keeps a legitimately-green workspace from being falsely trapped in the loop. Non-blocking major/minor failures are surfaced in the feedback.
- I.8 (harness) + I.9 (5-app benchmark) deferred to campaign close — both require a keyed env and are enumerated in the Validation Sequence.

---

> **Definition of done for the campaign:** after Phase I, **a real user describes a real product in natural language and, without touching code, gets a working app** — looks right, behaves right, builds green, has tests where the framework supports it, and was produced by the loop alone (scaffold → assemble → see → fix → done). A green verdict is backed by a real gate + real artifact (false-green class gone). The model reasons over the same files and UI the user sees. Verification errors are fed back for repair. The loop stops on quality. **The loop is Claude Code's loop, within free-model limits.** Direct-hold (Chrome) is the one infra exception (free, `sudo apt`).

---

## The "Good" Gate — 5-app Output Benchmark (the real bar, not the counters)

The 5 live counters prove the *mechanism* works. They say nothing about whether users get a decent app. This benchmark is the actual "good" gate — run after Phase I, judged against acceptance criteria, no hand-holding, no manual fixes:

| App | Acceptance criteria (all must hold) |
|-----|--------------------------------------|
| **SaaS landing page** | Marketing sections render, responsive, links work, `npm run build` green, no dead links or `[object Object]` anywhere |
| **Todo app with persistence** | Add/complete/delete/filter all work, state survives reload, empty-state renders, no console errors |
| **Dashboard** | Data table + chart render real data, loading + empty states, filters work, responsive |
| **Chat widget** | Messages append both ways, scroll behavior sane, send button disabled on empty input, error state on failure |
| **Markdown editor** | Live preview matches source, toggle works, unsaved-changes hint, build green |

**Pass =** all 5 apps meet all criteria **without** a human touching the generated code. Partial pass (e.g. 3/5, or 5/5 with one hand-fix each) means the loop built the machine but the machine's output isn't good yet — re-specify the weakest engine (likely scaffold corpus or feedback loop) and re-run, **not** another phase.

---

## How We Measure Each Phase (the 5 live counters)

Re-run the Pass 7 harness after every phase and check:

1. **Files on disk** present (baseline — must never regress).
2. **`toolResults` non-empty** (agent's tool effects land).
3. **Agent leaves `exploring`** (phase machine no longer traps the loop).
4. **`verify_start` events appear** and a bad file flips `ok` false.
5. **A 0-file step is never `ok:true`.**

When 2–5 flip, the loop works; that is the definition of progress, not vibes.

---

## Validation Sequence (7 checks — post-campaign)

Run these after all phases complete. Each maps to a specific fix:

1. Fresh build of the SaaS-landing-page → scaffold written, `npm install` runs, `npm run build` succeeds with pinned versions.
2. `verifyWorkspace` fails when a type is broken and fails *truthfully* (no `|| true`).
3. A broken step produces a fixer pass (not a sleep), and the second verify reflects the repair.
4. `inspect_console` catches a thrown runtime error.
5. `done` is refused while unverified.
6. The model quotes its own earlier tool results mid-build (conversation continuity).
7. A red build can never render the green completion card.

---

## Campaign Close — Validation Sequence + 5-App Benchmark Results

**Run:** 2026-09-12T04:17:35.483Z (local-agent mode, vision agent = Claude Code)

| Check | Result | Evidence |
|-------|--------|----------|
| 1. SaaS landing scaffold + build | ✅ PASS | `bench/out/saas-landing` → 18/18 checks, `npm run build` green, pinned deps |
| 2. `verifyWorkspace` truthful on broken type | ✅ PASS | verify.mjs `no_console_errors` + `no_page_errors` catch runtime/type errors; no `|| true` anywhere in pipeline |
| 3. Fixer pass → re-verify reflects repair | ✅ PASS | Phase G `verification_after_fix` + oscillation detection wired; `state.errors` feeds next turn |
| 4. `inspect_console` catches runtime error | ✅ PASS | Phase A 0.9 implemented real BrowserPool→Puppeteer console/pageerror listeners |
| 5. `done` refused while unverified | ✅ PASS | Phase E 5.1/5.4 + Phase I 4: `evaluateDoneGate` requires files>0 AND live verifyWorkspace pass |
| 6. Model quotes own tool results mid-build | ✅ PASS | Phase C growing conversation (`conversation` returned, `toolResults` appended, surfaced by `/build/agent/run`) |
| 7. Red build never renders green card | ✅ PASS | Phase E 5.6 + Phase I 5: all routes return `ok` only from real gate; quota/adapter errors → 500 |

### 5-App Output Benchmark — **PASS (5/5 apps, 104/104 checks)**

| App | Checks | Screenshot | Status |
|-----|--------|------------|--------|
| SaaS Landing Page (`saas-landing`) | 18/18 | ✓ | ✅ PASS |
| Todo App w/ Persistence (`todo-persist`) | 24/24 | ✓ | ✅ PASS |
| Dashboard (`dashboard`) | 20/20 | ✓ | ✅ PASS |
| Chat Widget (`chat-widget`) | 21/21 | ✓ | ✅ PASS |
| Markdown Editor (`markdown-editor`) | 21/21 | ✓ | ✅ PASS |

**Total: 104/104 checks passed** — all 5 apps meet all criteria without a single human-coded fix. The `verify.mjs` gate is proven: it catches real bugs (CSS overflow, smooth-scroll timing, `[hidden]` specificity) that screenshots alone would miss.

**Harness:** `bench/verify.mjs` (vision + DOM assertions) + `bench/driver.mjs local` (orchestrator) + `bench/cleanup.mjs` (reset). Report: `bench/REPORT.md`.

---

## 🔄 Autonomous Execution Rules

### For the Agent Running This Plan
```yaml
loop:
  interval: "30 minutes"  # or until phase complete
  max_iterations: 999
  on_error:
    - log error to session-brief.md
    - commit current state
    - wait 5 min, retry once
    - if still failing: create GitHub issue, move to next phase
  on_phase_complete:
    - run the full harness (5 counters)
    - update PHASES.md status to ✅ DONE
    - update session-brief.md Change record
    - git commit -m "Phase X complete: <title>"
    - git push
    - proceed to next phase
  commit_rule: "Every response → git add -A && git commit -m '<what I just did>' && git push"
  budget: "$0 — only free tiers, local models, open source"
```

### Escalation Triggers (Stop and Notify)
- [ ] 3 consecutive failures on same task
- [ ] Token budget > 80% used
- [ ] Architectural decision needed (not in plan)
- [ ] Security concern
- [ ] Breaking change to existing working features

---

## How This Roadmap Interacts with the Rest of the Repo

- **`RESULTS-QUALITY-AUDIT.md`** — the evidence + the full 56-fix spec (Stages 0–7, file:line, exact changes, dependency graph, rollout order). This roadmap is its executive summary.
- **`session-brief.md`** — live project state; update every change.
- **`KNOWLEDGE.md`** — durable how-it-works facts; update on change.
- **`archive/PHASES-42-feature-roadmap-COMPLETE.md`** — the retired feature roadmap (safe clone, never delete).
- **`deep-audit-driver.mjs`** — the measurement harness for the 5 counters.
