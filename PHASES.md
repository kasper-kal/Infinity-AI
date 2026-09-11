# Infinity AI — Master Roadmap: Close the Loop Gap

> **Read this file at the start of EVERY session.** This is the authoritative roadmap — what we are doing NOW and why. The previous 42-phase feature roadmap (all phases COMPLETE) is archived at `archive/PHASES-42-feature-roadmap-COMPLETE.md` — it records what was built; this file is what comes next.

---

## 🎯 Mission
Make Infinity **THE BEST IT CAN BE for $0** — using only free tiers, local models, and open source. STRICTLY ZERO free trials; every service/API/library stays permanently 100% free.

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
| **H** | **Preview + Workspace Context (R2)** | R2 | 🔲 **NOT STARTED** |
| **I** | **Adaptive Stop + Real Tests (R3)** | R3 | 🔲 **NOT STARTED** |

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
| Fix implementation | **Phase A COMPLETE** — server boots, DB whole, `|| true` removed, real exit codes, `inspect_console` real, `WORKSPACE_ROOT` fixed. **Phase B COMPLETE** — real workspaces (git+deps), preflight advisory, scaffold engine (6.4/6.4a/6.4b/6.4c) built and build-proven. **Phase C COMPLETE** — phase machine killed, growing conversation verified (len=11), `done` tool registered, native `tool_calls`, stall detection, verify-after-edit, real state return, execute-plan uses tool-based agent. Live harness: ALL 6 counters PASS. Moving to Phase D. |

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

## 📦 Phase D: The World Comes Back In (R2) 🔲 NOT STARTED

### Goal
Verification reports reality; the reviewer judges code not labels; the executed app reaches the model; dead subsystems are wired or deleted.

### Requirements
- [ ] **4.1** — Real exit codes: remove every `|| true`; read true exit codes from tsc/vitest/eslint/npm run build; `ok = all real gates green` (`lib/structured-tools.ts:292-332`)
- [ ] **4.2** — Feedback to iterate: replace sleep-retry with — on `!verify.ok`, feed `formatVerificationFeedback` to `runAutonomousAgent` as the iterate goal (`routes/infinity/build.ts:1136-1156`)
- [ ] **4.3** — Preview agent in auto-pipeline: after `captureScreenshot`, call `/build/preview/agent` and use its DOM findings as `iterateGoal` instead of Vite stdout (`routes/infinity/build.ts:760-768` + `build-studio.tsx:1455-1466`)
- [ ] **4.4** — Structured DOM output: return `{interactiveElements, visibleText, consoleErrors, screenshotBase64}` from preview agent; install headless-Chrome deps (`routes/infinity/build.ts:1617-1728`)
- [ ] **4.5** — Reviewer sees code: in `applyCoderChanges`, store real bytes per changed file (via `readWorkspaceFile`) instead of `[Modified by step-X: summary]` placeholder (`lib/build-orchestrator.ts:961-985`)
- [ ] **3.5** — Wire or delete dead prompt systems: promote `coderPromptV2`/`fixerPromptV2` to their roles; delete all other dead imports (`routes/infinity/build.ts:38-39` + `lib/build-prompts.ts:36,50,64`)
- [ ] **6.2** — Honor project conventions: read `CLAUDE.md`/`.cursorrules`/`package.json` scripts/tsconfig/vitest/eslint config into context on every agent call (`lib/build-project-context.ts:45`)
- [ ] **6.3** — Wire component corpus: add `generate_component` tool (shadcn/ui + design tokens) (`lib/ui-codegen.ts` + `lib/build-tools.ts`)

### Gate
`verify_start` events appear in telemetry; a broken file makes `ok` flip to false; reviewer output reflects real code. Dead prompt systems are promoted or deleted.

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

## 📦 Phase E: Green Must Mean Something (R3) 🔲 NOT STARTED

### Goal
Success is earned, not labeled. A green verdict is backed by a real gate + real artifact.

### Requirements
- [ ] **5.1** — Wire `runDoneContract` as the real stop rule: `checkDone` calls `runDoneContract(workspace)`; done only when it passes; errors returned as feedback otherwise (`lib/build-done-contract.ts` + `lib/build-agent.ts:167-175`)
- [ ] **5.2** — Per-step quality gate: after each step's `writeWorkspaceFile`, run `verifyWorkspace`; on fail, re-iterate the same step before advancing (`routes/infinity/build.ts:1136`)
- [ ] **5.3** — Living plan object: plan steps carry `{status, files[], verifyResult}`; agent updates status as it works (`routes/infinity/build.ts:574` + checkpoints)
- [ ] **5.4** — Green requires artifact + real gate: `ok = filesWereActuallyWritten && !feedback`; make verification run even when `hasIsolated` is false (`routes/infinity/build.ts:1156` + `:1133`)
- [ ] **5.5** — Persist the mind: save real `finalPhase`, `editedFiles`, last decision rationale, diff/summary of `workingContext`; on resume, inject into agent's first message (`routes/infinity/build.ts:695,798` + `lib/build-checkpoints.ts:213` + `build-agent.ts:495-501`)
- [ ] **5.6** — Failure honesty: any fallback (canned plan, quota 429, adapter error) must set `plan.fallback:true` and never reach `ok:true`; on quota: retry-with-backoff then fail loudly (`routes/infinity/build.ts:179-181` + `:1156` + model-router/quota path)

### Gate
The 0-file `ok:true` case from Pass 7 Live-C **cannot occur**; a silent canned plan is never returned as success. A red build can never render the green completion card.

### Implementation Plan
1. Rewrite `ok` logic: requires `filesWritten > 0` AND a verification gate passed
2. Wire `DoneContractEngine` as the actual stop rule in iterate/execute-plan
3. Add per-step quality gate: each step must pass verification before marking complete
4. Fix checkpoint to persist actual phase, reasoning, and token usage (not hardcoded values)
5. Remove all degraded success paths — failure is failure
6. Run harness — counter 5 (0-file step never `ok:true`) must pass

### Files to Create/Modify
- `artifacts/api-server/src/routes/infinity/build.ts` — `ok` logic, checkpoint fields
- `artifacts/api-server/src/lib/build-done-contract.ts` — wire as stop rule
- `artifacts/api-server/src/lib/build-agent.ts` — per-step quality gate, real state return
- `artifacts/api-server/src/lib/db/src/schema/build-checkpoints.ts` — persist real state

---

## 📦 Phase F: The Model Sees Bytes (R2/R3) 🔲 NOT STARTED

### Goal
Planner and coder read real file contents, not a 900-token map; one prompt system, not four; the model reasons over the same files the user sees.

### Requirements
- [ ] **3.1** — File bytes at decision points: `read_file` the step's declared files before the coder call and inline contents (token-capped) (`routes/infinity/build.ts:1082-1110` + `lib/build-agent.ts:215-220`)
- [ ] **3.2** — Repo context + token budget: add `git ls-files` paths, `package.json` scripts/deps, first 200 lines of README; raise `maxTokens` from 900 to ≥4000; drop 4 fixed dropdowns (`routes/infinity/build.ts:152-183`)
- [ ] **3.3** — Concise role tag: replace ~500-token identity block with ~60 tokens ("You are Infinity, an autonomous software engineer. Prefer reading over assuming.") (`lib/infinity-prompt.ts:20-50`)
- [ ] **7.1–7.20** — Design fixes tail: all remaining audit design-level fix mappings (see table below)

### Gate
Captured coder request contains real file bytes; truncated file-map JSON can no longer produce a silent zero-write `ok`.

### Implementation Plan
1. Feed planner real file contents (not just path + purpose + 8 symbols)
2. Extend planner input with repo context: file tree, config files, key modules
3. Replace ~500-token identity boilerplate with concise role tag
4. Work through design fixes 7.1–7.20 (see audit fix mapping table below)
5. Run full harness — all 5 counters green, campaign complete

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

## 📦 Phase G: Error Feedback Loop (R1+R2) 🔲 NOT STARTED

### Goal
Verification failures are fed back to the model for repair. The loop learns from its mistakes. No error is swallowed by `\|\| true`, sleep-retry, or blind polling.

### Requirements
- [ ] **G.1** — Verification errors fed to model: on `!verify.ok`, feed `formatVerificationFeedback(verify)` output to the model as the next iteration's goal — not a sleep, not a blind retry (`routes/infinity/build.ts:1131-1156`)
- [ ] **G.2** — Fixing phase connected: after `tryLocalModelFix` applies patches, re-run `verifyWorkspace` and push the result into `state.toolResults` so the model sees whether the fix worked (`build-agent.ts:434-457`)
- [ ] **G.3** — Oscillation detection: maintain rolling fingerprint of workspace state across last 6 iterations; if ≥2 identical fingerprints, inject "No progress detected — stop repeating and pick a different approach" as an error (`build-agent.ts`)
- [ ] **G.4** — Errors are first-class: the `## ERRORS SO FAR` block in the agent prompt includes verification failures, oscillation warnings, and tool errors — the model sees what went wrong and can change strategy
- [ ] **G.5** — No `|| true` anywhere in the verification pipeline: every command's exit code is honored; every failure surfaces to the model

### Gate
A failing verify → fix → re-verify cycle completes in the live loop. The model sees verification output after applying a fix. Oscillation triggers a strategy change, not an infinite repeat.

### Implementation Plan
1. Replace sleep-retry in `build.ts` with fixer pass + re-verify
2. Add `fixing` → `verifying` transition to the agent loop
3. Implement oscillation detection with rolling fingerprint
4. Wire all verification output into the agent's `## ERRORS SO FAR` block
5. Remove every `|| true` from verification commands
6. Run harness — verify cycle works end-to-end

### Files to Create/Modify
- `artifacts/api-server/src/routes/infinity/build.ts` — replace sleep-retry with fixer + re-verify
- `artifacts/api-server/src/lib/build-agent.ts` — fixing transition, oscillation detection, error block

---

## 📦 Phase H: Preview + Workspace Context (R2) 🔲 NOT STARTED

### Goal
The model sees what the user sees. Screenshot + DOM reach the model (not just the user). The full workspace context — file tree, config, conventions — feeds every agent call.

### Requirements
- [ ] **H.1** — Screenshot to model: after `captureScreenshot`, send the image to the model as a tool result (not just POST to UI) (`routes/infinity/build.ts:760-768`)
- [ ] **H.2** — DOM to model: call `/build/preview/agent` in the auto-pipeline; return structured `{interactiveElements, visibleText, consoleErrors, screenshotBase64}` to the model (`routes/infinity/build.ts:1617-1728`)
- [ ] **H.3** — Install headless Chrome deps: `sudo apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64` (the infra exception — free, `sudo apt`)
- [ ] **H.4** — Workspace context in every call: read `git ls-files`, `package.json` scripts/deps, `tsconfig.json`, `vitest.config.*`, `eslint.config.*`, `.eslintrc.*`, and first 200 lines of `README.md` into the agent's system prompt on every call (`lib/build-project-context.ts:45`)
- [ ] **H.5** — Project conventions honored: `CLAUDE.md`/`.cursorrules` read and injected as behavioral instructions for the agent
- [ ] **H.6** — File tree available: `list_files` tool result from the first iteration persists in context for subsequent iterations (the agent doesn't need to re-discover the project structure)

### Gate
Mid-build, the model can quote a screenshot observation ("the header is misaligned") or a DOM finding ("button text says 'Submit' but should say 'Send'"). The agent prompt contains real project config.

### Implementation Plan
1. Install headless Chrome dependencies on the host
2. Wire preview agent into the auto-pipeline (after screenshot capture)
3. Send screenshot + DOM findings as tool results to the model
4. Read project config files into agent context on every call
5. Read `CLAUDE.md`/`.cursorrules` as behavioral instructions
6. Persist file tree across iterations
7. Run harness — model references real visual/DOM output in its reasoning

### Files to Create/Modify
- `artifacts/api-server/src/routes/infinity/build.ts` — preview agent in auto-pipeline, screenshot to model
- `artifacts/api-server/src/lib/build-project-context.ts` — workspace context injection
- `artifacts/api-server/src/lib/build-agent.ts` — persist file tree across iterations

---

## 📦 Phase I: Adaptive Stop + Real Tests (R3) 🔲 NOT STARTED

### Goal
The loop stops based on quality, not a counter. Real tests run and report failures. Every step is verified before the next begins. "Done" is an external verdict, not a self-report.

### Requirements
- [ ] **I.1** — Adaptive stop: `while (!done && iteration < maxBudget && !stallDetected && !allGatesGreen)` — stall detection = no file change in 3 turns; `allGatesGreen` = build + typecheck + tests + lint all pass (`routes/infinity/build.ts`)
- [ ] **I.2** — Real test execution: `npx vitest run` (no `|| true`), `npx eslint -f json .` (no `|| true`), `npm run build` (no `|| true`); failures fed back to the model via `formatVerificationFeedback` (`lib/structured-tools.ts:292-332`)
- [ ] **I.3** — Per-step verification: each step runs `verifyWorkspace` before marking complete; on failure, the same step re-iterates (not the next step) (`routes/infinity/build.ts:1136`)
- [ ] **I.4** — Done contract wired: `runDoneContract(workspace)` is called when the model invokes `done`; the contract's real gates (build, typecheck, tests, lint) must pass; the model cannot declare done if the contract fails (`lib/build-done-contract.ts` + `lib/build-agent.ts:167-175`)
- [ ] **I.5** — Fake gates marked honestly: `build-done-contract.ts`'s a11y/perf/SEO/visual/bundle checks return `status: "not-enforced"` (not `passed:true`), so "done" is an honest statement
- [ ] **I.6** — Iteration budget is a backstop, not the stop rule: the primary stop conditions are (a) model calls `done` + contract passes, (b) all gates green + no changes in 2 turns, or (c) stall detected; maxIterations is only a safety cap
- [ ] **I.7** — **Coder writes tests as part of "done":** the coder contract includes a hard line — "write tests when the framework supports it (Vitest); define what shipped means for this app (data model, error/empty/loading states, auth boundaries, responsive + a11y). No TODOs, no hardcoded demo data, no invented dependencies." Green without tests is a weak "good."

### Gate
The 0-file `ok:true` case cannot occur. A failing test prevents "done". A broken build prevents "done". The loop stops on quality, not on a counter reaching 20.

### Implementation Plan
1. Implement stall detection (no file change in 3 turns → stop)
2. Wire real test execution: vitest, eslint, build — no `|| true`
3. Add per-step verification gate
4. Wire `runDoneContract` as the actual stop rule
5. Mark fake gates as `status: "not-enforced"`
6. Add quality-based stop conditions alongside the iteration cap
7. Add test-writing to the coder contract (I.7)
8. Run harness — counter 5 (0-file step never `ok:true`) must pass; all 5 counters green
9. Run the **5-app output benchmark** (§ The "Good" Gate) — the campaign is done when apps pass, not when counters flip

### Files to Create/Modify
- `artifacts/api-server/src/routes/infinity/build.ts` — adaptive stop, quality-based stopping
- `artifacts/api-server/src/lib/structured-tools.ts` — real test execution
- `artifacts/api-server/src/lib/build-agent.ts` — done contract integration, stall detection
- `artifacts/api-server/src/lib/build-done-contract.ts` — wire as stop rule, mark fake gates

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
