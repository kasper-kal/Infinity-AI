# Infinity AI — Master Implementation Phases

> **Read this file at the start of EVERY session.** This is the authoritative roadmap. Update it when phases complete or scope changes.

---

## 🎯 Mission
Make Infinity **THE BEST IT CAN BE for $0** — competitive with Claude Code, Replit Agent, Cursor, OpenHands, Cline, Aider, Goose — using only free tiers, local models, and open source.

---

## 📋 Phase Overview

| Phase | Title | Status | Est. Effort | Dependencies |
|-------|-------|--------|-------------|--------------|
| **15.8** | **Build Project Map Subsystem** | 🔲 **IN PROGRESS** | ~16-24h | Phase 15.1-7 |
| **22** | **Universal Tool Layer — Capability Integration** | 🔲 **TODO** | ~24-40h | Phase 21 |
| **23** | **Universal Tool Layer — Agent Loop & UX** | 🔲 **TODO** | ~16-24h | Phase 22 |
| **24** | **Universal Tool Layer — Resilience & Persistence** | 🔲 **TODO** | ~12-20h | Phase 22, 23 |

---

## 📦 Phase 15.8: Build Project Map Subsystem (CURRENT)

### Goal
Add pre-build analysis that constructs persistent project understanding — framework detection, architecture mapping, change impact analysis, and smart context selection.

### Requirements
- [ ] **Pre-build analysis** — construct project understanding:
  - [ ] Framework (React, Vue, Svelte, Next, Vite, etc.)
  - [ ] Package manager (pnpm, npm, yarn, bun)
  - [ ] Entry points (main, routes, app)
  - [ ] Architecture (monorepo, feature folders, layer structure)
  - [ ] Important files (config, schema, types, main exports)
  - [ ] Database (Drizzle, Prisma, raw SQL, none)
  - [ ] Routes/API structure
  - [ ] Components/UI library
  - [ ] Tests (Jest, Vitest, Playwright, none)
  - [ ] Config files (tsconfig, vite.config, tailwind, etc.)
- [ ] **Persistent project map** — stored in `.infinity/project-map.json`, updated incrementally
- [ ] **Change impact analysis** — when files modified, update map, detect affected areas
- [ ] **Smart file inclusion** — only relevant files in context based on goal

### Implementation Plan
1. **Project Map Engine** — `artifacts/api-server/src/lib/build-project-map.ts`
   - Static analysis on pre-build (glob patterns, package.json, config files)
   - Incremental update on file changes (watch + diff)
   - Impact analysis (import graph, export usage)
   - Smart context selection (relevance scoring by goal keywords)
2. **Integration** — extend `build-orchestrator.ts` pre-build phase
3. **Persistence** — `.infinity/project-map.json` + DB cache
4. **API** — `GET /build/project-map/:projectId`, `POST /build/project-map/:projectId/refresh`

### Files to Create/Modify
- `artifacts/api-server/src/lib/build-project-map.ts` (new)
- `artifacts/api-server/src/lib/build-orchestrator.ts` (extend — pre-build hook)
- `artifacts/api-server/src/routes/jarvis/build.ts` (extend — project map routes)

---

## 📦 Phase 22: Universal Tool Layer — Capability Integration

### Goal
Register every existing Infinity capability as a namespaced tool in the Phase 21 registry. **Register ONLY functionality that actually exists** — no fake implementations. Build Mode becomes a consumer of the registry, not an isolated ecosystem.

### Requirements
- [ ] **Web** — `web.search` (Tavily), `web.fetch`, `web.extract` — wire to existing Tavily call in `chat.ts`
- [ ] **Browser** — `browser.navigate`, `browser.click`, `browser.type`, `browser.scroll`, `browser.screenshot`, `browser.inspectDom`, `browser.inspectConsole` — reuse `browser-pool.ts` + `build-tools.ts` browser tools
- [ ] **Files** — `files.list`, `files.read`, `files.write`, `files.upload`, `files.move`, `files.delete` (safe) — reuse `workspace.ts` + `build-tools.ts`
- [ ] **Vision** — `vision.analyze`, `vision.screenshot` — reuse existing vision path
- [ ] **Data Lab** — `data.analyze`, `data.transform`, `data.stats`, `data.visualize`, `data.inspect` — register existing Data Lab if present
- [ ] **Memory** — `memory.read`, `memory.write`, `memory.update`, `memory.delete` — reuse `project-memory.ts` / `userMemories`
- [ ] **Research** — `research.start`, `research.continue`, `research.status`, `research.extract` — reuse `research-engine.ts`
- [ ] **Build** — `build.run`, `build.workspace`, `build.terminal`, `build.verify` — consume `build-tools.ts` + `build-orchestrator.ts`
- [ ] **Evolving** — `evolution.inspect`, `evolution.propose`, `evolution.apply`, `evolution.verify`, `evolution.rollback` — consume `self-evolution.ts` with existing guardrails preserved
- [ ] **Integrations** — `gmail.search`, `gmail.send`, `spotify.search`, etc. — register only what `secrets.ts` / connectors actually support
- [ ] **Build Mode refactor** — `build-orchestrator.ts` / `build-agent.ts` call the registry instead of the local `TOOL_DEFINITIONS` switch (no behavior change to end users)
- [ ] **Verify each tool returns `UniversalToolResult`** and feeds structured results forward (no manual prompt-copying of intermediate data)

### Files to Create/Modify
- `artifacts/api-server/src/lib/tools/` (new directory — one file per category: web.ts, browser.ts, files.ts, vision.ts, data.ts, memory.ts, research.ts, build.ts, evolution.ts, integrations.ts)
- `artifacts/api-server/src/lib/build-orchestrator.ts` (refactor to consume registry)
- `artifacts/api-server/src/lib/build-agent.ts` (refactor to consume registry)

---

## 📦 Phase 23: Universal Tool Layer — Agent Loop & UX

### Goal
Make Chat a real **iterative reasoning/tool loop** where the LLM dynamically chains tools across capabilities in one task, and surface that execution in the UI as an agent timeline.

### Requirements
- [ ] **Iterative agent loop** — `artifacts/api-server/src/lib/universal-agent.ts` (new): LLM → tool call → result → LLM → ... until final response. Model decides tool count dynamically (not a fixed multi-tool command).
- [ ] **Parallel tool execution** — independent calls run concurrently (safe concurrency limit); dependency ordering preserved when a tool consumes an earlier result.
- [ ] **Tool chaining UX** — agent/tool execution timeline in Chat (Thinking → ✓ Web Search → ✓ Browser → ... → Done). Expandable per-step: tool used, args, result, duration, errors, artifacts. Show telemetry only, no hidden chain-of-thought.
- [ ] **SSE/streaming** — emit tool events alongside chat stream (reuse `build-events.ts` event infra).
- [ ] **Memory integration in loop** — agent reads relevant memory, performs task, decides (relevance rules) whether to write memory.
- [ ] **Evolving integration in loop** — `evolution.propose` → review → approval if required → `evolution.apply` → tests → verify → commit/rollback. Never arbitrary self-modification.
- [ ] **Artifacts** — tool outputs become interoperable artifacts (Research Report, Image Analysis, Dataset/Chart, Screenshot, Code/Diff, Evolution Record) consumable by later tools.
- [ ] **Model-agnostic** — loop only depends on `LLMAdapter` interface.

### Cross-Capability Examples That MUST Work (end-to-end)
1. "Search the web for latest React changes, compare to my project, inspect the running site, tell me what to update." → `web.search → files → browser → analysis → response`
2. "Look at this uploaded dataset, analyze it, create charts, remember findings." → `files → data → visualize → memory`
3. "Research this topic, browse sites, create report, save conclusions to memory." → `research → web → browser → artifact → memory`
4. "Inspect Infinity's implementation, find weakness, improve, test, keep only if it works." → `files → build → evolution → tests → verify → commit/rollback`
5. "Find latest info on X, analyze numbers, visualize, explain." → `web → data → visualize → response`

### Files to Create/Modify
- `artifacts/api-server/src/lib/universal-agent.ts` (new)
- `artifacts/api-server/src/routes/jarvis/chat.ts` (wire universal-agent into chat)
- `artifacts/jarvis/src/components/debug/` (extend — agent timeline panel)
- `artifacts/jarvis/src/hooks/use-chat-stream.ts` (handle tool-event SSE)

---

## 📦 Phase 24: Universal Tool Layer — Resilience & Persistence

### Goal
Make the Universal Tool Layer robust to failures and durable across interruptions. Integrates cleanly with existing Build task/event infra — no parallel task system.

### Requirements
- [ ] **Recovery** — tool failure → inspect error → retry if appropriate → alternate tool/strategy → continue. Distinguish recoverable / fatal / permission / approval-required errors. Task continues (does not auto-terminate).
- [ ] **Long-running task state** — persistent task maintains: goal, status, toolCalls, results, artifacts, errors, currentStep, createdAt, updatedAt. Resume after interruption (reuse `build-events.ts` / Build task infra).
- [ ] **Tool failure handling** — diagnostic recovery per tool type (npm fails → pnpm → inspect lockfile; browser fails → restart pool; etc.) — extends Phase 15's resilient tool layer, NOT duplicating it.
- [ ] **Permission enforcement** — deny/allow by risk level; `SELF_MODIFICATION` preserves Evolving checkpoints/snapshots/rollback; `DESTRUCTIVE` requires approval; workspace isolation/path protections never weakened.
- [ ] **Large-output handling** — truncation/summarization so big tool results don't destroy context window.
- [ ] **Integration tests** — one call, sequential, dependent, parallel, failure/retry, permission denial, large output, artifact passing, memory RW, browser+search chaining, files+data chaining, build+browser chaining, evolving+verify, task resume.
- [ ] **End-to-end multi-tool scenarios** — several tests where one request genuinely crosses 3–6 capabilities (the 5 examples from Phase 23).
- [ ] **Definition of done met**: centralized registry, dynamic multi-tool Chat, result consumption, parallel execution, existing Build tools reused, all capabilities in one loop, permissions enforced, UI-visible execution, resumable tasks, recoverable failures, cross-capability examples work, existing functionality intact, typecheck + build + integration tests pass.

### Files to Create/Modify
- `artifacts/api-server/src/lib/universal-agent.ts` (extend — recovery, task state)
- `artifacts/api-server/src/lib/tool-resilience.ts` (new — retry/recovery/diagnostics)
- `artifacts/api-server/src/lib/tool-persistence.ts` (new — task state, resume)
- `artifacts/api-server/src/lib/build-tools.ts` (extend — resilience reuse)
- `artifacts/api-server/src/test/` (new — integration tests for the above)

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
    - update PHASES.md status to ✅ DONE
    - update session-brief.md Change record
    - git commit -m "Phase X complete: <title>"
    - git push
    - proceed to next phase
  commit_rule: "Every response → git add -A && git commit -m '<what I just did>' && git push"
  budget: "$0 — only free tiers, local models, open source"
```

### Phase Completion Criteria
- [ ] All requirements checked off
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Build passes (`npm run build`)
- [ ] Basic smoke test works
- [ ] Documentation updated
- [ ] Committed and pushed

### Escalation Triggers (Stop and Notify)
- [ ] 3 consecutive failures on same task
- [ ] Token budget > 80% used
- [ ] Architectural decision needed (not in plan)
- [ ] Security concern
- [ ] Breaking change to existing working features

---

## 📝 Session Startup Checklist
**Run this at the start of EVERY session:**

1. [ ] Read `PHASES.md` (this file)
2. [ ] Read `session-brief.md` (live state)
3. [ ] Read `KNOWLEDGE.md` (how things work)
4. [ ] Check current phase from PHASES.md
5. [ ] Run `npm run typecheck` and `npm run build` to verify baseline
6. [ ] Execute next unchecked task in current phase
7. [ ] After EVERY change: update PHASES.md + session-brief.md + git commit + push

---

## 🎯 Current Phase: **Phase 15.8 — Build Project Map Subsystem** 🔲 IN PROGRESS

## 🎯 Next Phases:
1. **Phase 22** — Universal Tool Layer — Capability Integration
2. **Phase 23** — Universal Tool Layer — Agent Loop & UX
3. **Phase 24** — Universal Tool Layer — Resilience & Persistence