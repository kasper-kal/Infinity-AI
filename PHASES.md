# Infinity AI — Master Roadmap: Close the Loop Gap

> **Read this file at the start of EVERY session.** This is the authoritative roadmap — what we are doing NOW and why. The previous 42-phase feature roadmap (all phases COMPLETE) is archived at `archive/PHASES-42-feature-roadmap-COMPLETE.md` — it records what was built; this file is what comes next.

---

## 🎯 Mission
Make Infinity **THE BEST IT CAN BE for $0** — competitive with Claude Code — using only free tiers, local models, and open source. STRICTLY ZERO free trials; every service/API/library stays permanently 100% free.

---

## Why we are here (the answer, in one paragraph)

The 42-phase feature build is done — and it produced the exact gap this roadmap exists to close. The deep audit (`RESULTS-QUALITY-AUDIT.md`, Pass 2 + Pass 7) proved it live: **Infinity Build is a pipeline of stateless fresh API calls; Claude Code is one continuous self-correcting loop.** A real free-tier model ran the full shipped loop and wrote a real file to disk — but a step that wrote **0 files** counted as `overallOk:true` (verification never runs without a git workspace), the iterate agent stalled in `exploring` for 5 iterations with `toolResults:[]` and still came back HTTP 200, and the checkpoint recorded **hardcoded** `tokenUsage:0` / `phase:"planning"`. The gap is **harness-inherent, not model-quality**: a stronger model cannot fix a loop that was never wired. More phases won't close it — rebuilding the loop will. That is this roadmap.

**(Caveat on purpose: this file deliberately replaces the 42-phase list. We are not "adding a phase 43" — we are finishing the one system that matters.)**

---

## Current status

| Item | State |
|------|-------|
| Deep audit | COMPLETE — Passes 0–7. Answer: loop-gap. 63 findings → **56 fixes** (Stage 0–7 map in Pass 4). |
| Live measurement harness | READY — `/tmp/single-loop-proof.mjs` pattern in `deep-audit-driver.mjs`: one full run captures files-on-disk, toolResults, phase, verify events, 0-file-ok. This is how "fixed" is measured. |
| Model access | OpenRouter free (`nex-agi/nex-n2.5-pro:free`, Neon `llm_keys:audit-run-key`) working. NVIDIA `nvapi` alternate **403** (logged, not usable). |
| Fix implementation | **NOT STARTED** — we are at Phase 0, step 0. |

---

## The fix campaign (5 phases, dependency-ordered)

Map: 3 roots (Pass 4) — **R1** the loop has no self · **R2** the world never re-enters · **R3** green is a label, not a check.

**The five repair fronts (Pass 4, mapped to the roots):**

| # | Front | Root it kills | What changes | Key fixes |
|---|-------|---------------|--------------|-----------|
| 1 | **Real workspace** | R2 | Workspace = a real git repo with deps, not an empty `mkdir`. Preflight stops being a wall | 1.1–1.4, 0.x |
| 2 | **The loop becomes one conversation** | R1 | Kill the phase machine. One growing conversation, real `done` tool, native tool calls (not regex), a deterministic "verify after every edit" floor | 2.1–2.4, 2.6, 2.7 |
| 3 | **The world comes back in** | R2 | Deps run → `tsc`/`vitest`/eslint actually report reality; the rendered app + DOM reaches the model; the reviewer reads file bytes, not `[Modified by step-X]` labels | 4.1–4.5, 6.4 |
| 4 | **Green must mean something** | R3 | `ok` requires a real artifact (files written *and* a gate passed), `done` is a real tool, checkpoint persists reasoning not hardcoded strings/zero tokens, no silent degraded success | 5.1–5.6 |
| 5 | **The model sees bytes** | R2 | Planner/coder fed real file contents (not a 900-token map), execute-plan uses tools instead of blind `jsonMode`; one prompt system, not four | 3.1–3.5, 7.x |

*Phases A–E below expand the five fronts in order (A = front 1, B = front 2, … E = front 5).*

### Phase A — Real workspace (R2)
*What:* workspaces become real git repos with installed deps; the build button stops hitting the preflight wall.
*Fixes:* 0.1–0.5 (boot/DB/key fixes), 1.1–1.4 (WORKSPACE_ROOT → in-repo root, `ensureWorkspace` git-init + `.infinity`, preflight advisory, package.json + `npm install`).
*Gate:* fresh `execute-plan` on a new project returns 200 (preflight passes) and the project dir is a git repo with node_modules.

### Phase B — The loop is one mind (R1)
*What:* kill the phase machine. One growing conversation (not a fresh 2-message call each iteration), real `done` tool, **native `completion.tool_calls`** instead of regex parsing, a deterministic "verify-after-edit" floor, agent returns its true final state.
*Fixes:* 2.1–2.4, 2.6, 2.7 (+ 3.4 when execute-plan gains tools).
*Gate:* iterate exits `exploring`, produces **non-empty toolResults**, and its returned phase/state is real (not self-report).

### Phase C — The world comes back in (R2)
*What:* verification reports reality; the reviewer judges code not labels; the executed app reaches the model.
*Fixes:* 1.4 + 4.1 (deps → real `tsc`/`vitest`/eslint gates with the `|| true` tautologies removed), 4.2/5.2 (feedback→iterate), 4.3–4.4 (preview agent + DOM to model; needs Chrome deps on host), 4.5 (reviewer reads file bytes), 6.4 (wire the dead generators/templates into scaffold).
*Gate:* `verify_start` events appear in telemetry; a broken file makes `ok` flip to false; reviewer output reflects real code.

### Phase D — Green must mean something (R3)
*What:* success is earned, not labeled.
*Fixes:* 5.4 (`ok` requires files-written AND a real gate — the 0-file false-green is impossible), 5.1 (done-contract wired as the stop rule), 5.3/5.5 (checkpoint persists real phase/reasoning, not hardcoded `"planning"`/zero tokens), 5.6 (no degraded path may report success), 5.2 (per-step quality gate).
*Gate:* the 0-file `ok:true` case from Pass 7 Live-C **cannot occur**; a silent canned plan is never returned as success.

### Phase E — The model sees bytes (R2/R3)
*What:* planner and coder read real file contents, not a 900-token map; one prompt system, not four.
*Fixes:* 3.1 (file bytes at decisions), 3.2 (planner gets repo context), 3.4 (execute-plan uses tools), 3.5 (single prompt source — delete imports-only `coderPromptV2`/`fixerPromptV2`), 7.1–7.20 design fixes tail.
*Gate:* captured coder request contains real file bytes; truncated file-map JSON can no longer produce a silent zero-write "ok".

> **Definition of done for the campaign:** after Phase D, a green verdict is backed by a real gate + real artifact (false-green class gone). After Phase E, the model reasons over the same files and UI the user sees — **the loop is Claude Code's loop, within free-model limits.** Direct-hold (Chrome) is the one infra exception (free, `sudo apt`).

---

## How we measure each phase (the 5 live counters)

Re-run the Pass 7 harness after every phase and check:

1. **Files on disk** present (baseline — must never regress).
2. **`toolResults` non-empty** (agent's tool effects land).
3. **Agent leaves `exploring`** (phase machine no longer traps the loop).
4. **`verify_start` events appear** and a bad file flips `ok` false.
5. **A 0-file step is never `ok:true`.**

When 2–5 flip, the loop works; that is the definition of progress, not vibes.

---

## Autonomous Execution Rules

- **Read `session-brief.md` first** (live state, change record, next actions) — it is the day-to-day continuation of this roadmap.
- Execute the **next action** in the current Phase; after **every** change, update `session-brief.md`'s Change record + project state.
- After **every** phase completes: run the full harness (5 counters), update this file's status, update `PHASES.md` phase table, commit + push.
- **NEVER fix typecheck errors unless explicitly asked.** Never use the Lucide icon `Sparkles`.
- Every response ends with `git add -A && commit && push`. Every 5 min an auto-commit cron covers stragglers.
- Escalate (ask the user) when a Phase's Gate cannot pass after genuine attempts, or when a fix would cost > €0.
- Audit constraint: product code is changed only when the user says "go" on implementation — this roadmap is the agreed direction.

---

## How this roadmap interacts with the rest of the repo

- **`RESULTS-QUALITY-AUDIT.md`** — the evidence + the full 56-fix spec (Stages 0–7, file:line, exact changes, dependency graph, rollout order). This roadmap is its executive summary.
- **`session-brief.md`** — live project state; update every change.
- **`KNOWLEDGE.md`** — durable how-it-works facts; update on change.
- **`archive/PHASES-42-feature-roadmap-COMPLETE.md`** — the retired feature roadmap (safe clone, never delete).
- **`deep-audit-driver.mjs`** — the measurement harness for the 5 counters.