# Infinity AI — Master Roadmap: Close the Loop Gap

> **Read this file at the start of EVERY session.** This is the authoritative roadmap — what we are doing NOW and why. The previous 42-phase feature roadmap (all phases COMPLETE) is archived at `archive/PHASES-42-feature-roadmap-COMPLETE.md` — it records what was built; this file is what comes next.

---

## 🎯 Mission
Make Infinity **THE BEST IT CAN BE for $0** — using only free tiers, local models, and open source. STRICTLY ZERO free trials; every service/API/library stays permanently 100% free.

---

## 📋 Phase Overview

| Phase | Title | Status |
|-------|-------|--------|
| **A** | **Real Workspace (R2)** | 🔲 **NOT STARTED** |
| **B** | **The Loop Is One Mind (R1)** | 🔲 **NOT STARTED** |
| **C** | **The World Comes Back In (R2)** | 🔲 **NOT STARTED** |
| **D** | **Green Must Mean Something (R3)** | 🔲 **NOT STARTED** |
| **E** | **The Model Sees Bytes (R2/R3)** | 🔲 **NOT STARTED** |

**Root causes (from the audit):** **R1** the loop has no self · **R2** the world never re-enters · **R3** green is a label, not a check.

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

## Current Status

| Item | State |
|------|-------|
| Deep audit | COMPLETE — Passes 0–7. Answer: loop-gap. 63 findings → **56 fixes** (Stage 0–7 map in Pass 4). |
| Live measurement harness | READY — `/tmp/single-loop-proof.mjs` pattern in `deep-audit-driver.mjs`: one full run captures files-on-disk, toolResults, phase, verify events, 0-file-ok. This is how "fixed" is measured. |
| Model access | OpenRouter free (`nex-agi/nex-n2.5-pro:free`, Neon `llm_keys:audit-run-key`) working. NVIDIA `nvapi` alternate **403** (logged, not usable). |
| Fix implementation | **NOT STARTED** — we are at Phase 0, step 0. |

---

## 📦 Phase A: Real Workspace (R2) 🔲 NOT STARTED

### Goal
Workspaces become real git repos with installed deps; the build button stops hitting the preflight wall. Workspace = a real git repo with deps, not an empty `mkdir`.

### Requirements
- [ ] **0.1–0.5** — Boot/DB/key fixes (infrastructure prerequisites)
- [ ] **1.1** — `WORKSPACE_ROOT` points to in-repo root, not a temp directory
- [ ] **1.2** — `ensureWorkspace` runs `git init` + creates `.infinity/` directory
- [ ] **1.3** — Preflight advisory: checks for missing workspace and surfaces actionable error
- [ ] **1.4** — `package.json` present and `npm install` runs successfully on workspace creation

### Gate
Fresh `execute-plan` on a new project returns 200 (preflight passes) and the project dir is a git repo with `node_modules`.

### Implementation Plan
1. Fix boot/DB/key infrastructure (fixes 0.1–0.5)
2. Rewrite `WORKSPACE_ROOT` to point to in-repo root
3. Extend `ensureWorkspace` with `git init` + `.infinity/` directory creation
4. Add preflight advisory that checks workspace state and reports clearly
5. Ensure `package.json` is created and `npm install` runs on workspace setup
6. Run harness — counter 1 (files on disk) must pass

### Files to Create/Modify
- `artifacts/api-server/src/lib/workspace.ts` — WORKSPACE_ROOT, ensureWorkspace rewrite
- `artifacts/api-server/src/routes/infinity/build.ts` — preflight checks, workspace validation

---

## 📦 Phase B: The Loop Is One Mind (R1) 🔲 NOT STARTED

### Goal
Kill the phase machine. One growing conversation (not a fresh 2-message call each iteration), real `done` tool, **native `completion.tool_calls`** instead of regex parsing, a deterministic "verify-after-edit" floor, agent returns its true final state.

### Requirements
- [ ] **2.1** — Agent uses one growing conversation across iterations (not fresh 2-message calls)
- [ ] **2.2** — Real `done` tool: agent signals completion via tool call, not self-report
- [ ] **2.3** — Native `completion.tool_calls` used instead of regex `parseToolCalls`
- [ ] **2.4** — Deterministic "verify after every edit" floor (hard gate, not optional)
- [ ] **2.6** — Agent returns its true final state (phase, reasoning, files changed)
- [ ] **2.7** — Identity context preserved across iterations (no boilerplate re-injection every turn)
- [ ] **3.4** — When execute-plan gains tools (deferred from Phase E if needed)

### Gate
Iterate exits `exploring`, produces **non-empty `toolResults`**, and its returned phase/state is real (not self-report).

### Implementation Plan
1. Rewrite build-agent iteration loop to grow conversation instead of resetting
2. Add `done` tool to tool registry — agent calls it when work is complete
3. Switch from regex `parseToolCalls` to native `completion.toolCalls`
4. Add deterministic verify-after-edit gate (runs verification after every file write)
5. Remove hardcoded state returns — agent outputs real phase + reasoning
6. Run harness — counters 2 (toolResults non-empty) and 3 (leaves exploring) must pass

### Files to Create/Modify
- `artifacts/api-server/src/lib/build-agent.ts` — iteration loop, conversation growth, tool calls
- `artifacts/api-server/src/lib/tool-registry.ts` — add `done` tool
- `artifacts/api-server/src/lib/llm-adapter.ts` — use native toolCalls

---

## 📦 Phase C: The World Comes Back In (R2) 🔲 NOT STARTED

### Goal
Verification reports reality; the reviewer judges code not labels; the executed app reaches the model.

### Requirements
- [ ] **1.4 + 4.1** — Deps installed → real `tsc`/`vitest`/eslint gates; remove `|| true` tautologies
- [ ] **4.2 + 5.2** — Feedback channel alive: preview output → iterate (not blank)
- [ ] **4.3–4.4** — Preview agent runs → DOM reaches the model (needs Chrome deps on host)
- [ ] **4.5** — Reviewer reads file bytes, not `[Modified by step-X]` placeholder labels
- [ ] **6.4** — Wire dead generators/templates (`framework-generators/`, `template-engine.ts`) into scaffold

### Gate
`verify_start` events appear in telemetry; a broken file makes `ok` flip to false; reviewer output reflects real code.

### Implementation Plan
1. Ensure deps are installed before verification; remove `|| true` from verify commands
2. Fix preview channel so iterate receives real feedback (Vite output or DOM)
3. Wire preview agent to produce DOM model accessible to the coder agent
4. Rewrite reviewer to read actual file contents from workspace
5. Wire framework generators and templates into the build scaffold step
6. Run harness — counter 4 (`verify_start` events, bad file → `ok:false`) must pass

### Files to Create/Modify
- `artifacts/api-server/src/lib/structured-tools.ts` — verifyWorkspace, remove `|| true`
- `artifacts/api-server/src/lib/build-orchestrator.ts` — reviewer reads file bytes
- `artifacts/api-server/src/routes/infinity/build.ts` — preview agent, feedback channel
- `artifacts/api-server/src/lib/framework-generators/` — wire into scaffold
- `artifacts/api-server/src/lib/template-engine.ts` — wire into scaffold

---

## 📦 Phase D: Green Must Mean Something (R3) 🔲 NOT STARTED

### Goal
Success is earned, not labeled.

### Requirements
- [ ] **5.4** — `ok` requires files-written AND a real gate passed (0-file false-green becomes impossible)
- [ ] **5.1** — Done-contract wired as the actual stop rule (not advisory)
- [ ] **5.3 + 5.5** — Checkpoint persists real phase/reasoning, not hardcoded `"planning"` / zero tokens
- [ ] **5.6** — No degraded path may report success
- [ ] **5.2** — Per-step quality gate (each step verified before marking complete)

### Gate
The 0-file `ok:true` case from Pass 7 Live-C **cannot occur**; a silent canned plan is never returned as success.

### Implementation Plan
1. Rewrite `ok` logic: requires `filesWritten > 0` AND a verification gate passed
2. Wire `DoneContractEngine` as the actual stop rule in iterate/execute-plan
3. Fix checkpoint to persist actual phase, reasoning, and token usage (not hardcoded values)
4. Remove all degraded success paths — failure is failure
5. Add per-step quality gate: each step must pass verification before marking complete
6. Run harness — counter 5 (0-file step never `ok:true`) must pass

### Files to Create/Modify
- `artifacts/api-server/src/routes/infinity/build.ts` — `ok` logic, checkpoint fields
- `artifacts/api-server/src/lib/build-done-contract.ts` — wire as stop rule
- `artifacts/api-server/src/lib/build-agent.ts` — per-step quality gate

---

## 📦 Phase E: The Model Sees Bytes (R2/R3) 🔲 NOT STARTED

### Goal
Planner and coder read real file contents, not a 900-token map; one prompt system, not four.

### Requirements
- [ ] **3.1** — Planner/coder fed real file contents at decision time (not 900-token summaries)
- [ ] **3.2** — Planner gets repo context (file tree, key files, config)
- [ ] **3.4** — Execute-plan uses tools instead of blind `jsonMode` single-shot
- [ ] **3.5** — Single prompt source: delete imports-only `coderPromptV2` / `fixerPromptV2`
- [ ] **7.1–7.20** — Design fixes tail (remaining audit findings)

### Gate
Captured coder request contains real file bytes; truncated file-map JSON can no longer produce a silent zero-write `ok`.

### Implementation Plan
1. Feed planner real file contents (not just path + purpose + 8 symbols)
2. Extend planner input with repo context: file tree, config files, key modules
3. Rewrite execute-plan to use tool-use agent instead of blind JSON single-shot
4. Consolidate prompt system: one source (`agent-prompts/*`), delete `build-prompts.ts` duplicates
5. Work through remaining design fixes (7.1–7.20)
6. Run full harness — all 5 counters green, campaign complete

### Files to Create/Modify
- `artifacts/api-server/src/lib/agent-prompts/planner.ts` — real file contents at input
- `artifacts/api-server/src/routes/infinity/build.ts` — execute-plan rewrite (tools, not jsonMode)
- `artifacts/api-server/src/lib/build-prompts.ts` — delete (replaced by agent-prompts)
- `artifacts/api-server/src/lib/build-agent.ts` — extended for tool-use execute-plan

---

> **Definition of done for the campaign:** after Phase D, a green verdict is backed by a real gate + real artifact (false-green class gone). After Phase E, the model reasons over the same files and UI the user sees — **the loop is Claude Code's loop, within free-model limits.** Direct-hold (Chrome) is the one infra exception (free, `sudo apt`).

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
