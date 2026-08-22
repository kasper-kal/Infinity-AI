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
4. **Phase 25** — Orchestration Engine (pipeline, parallel, adversarialVerify, judgePanel)
5. **Phase 26** — Specialized Subagents (code-reviewer, planner, researcher with schemas)
6. **Phase 27** — Virtual Worktrees + Parallel Agent Execution
7. **Phase 28** — Local Terminal Bridge (node-pty WebSocket)
8. **Phase 29** — MCP Client + Ecosystem Integration
9. **Phase 30** — VS Code Extension (Infinity Build Panel)

---

## 📦 Phase 25: Orchestration Engine (Claude Code Parity)

### Goal
Implement the core orchestration primitives that make Claude Code's multi-agent workflows possible — **entirely in-browser, $0 cost**, using prompt engineering + existing chat API.

### Requirements
- [ ] **pipeline(items, ...stages)** — concurrent, no barrier between stages (item A in stage 3 while B in stage 1)
- [ ] **parallel(thunks)** — barrier: all complete before returning
- [ ] **adversarialVerify(claim, votes=3)** — spawn N independent "skeptic" prompts, default to REFUTE, kill claim if majority refute
- [ ] **judgePanel(task, approaches[], judges[])** — generate N attempts → score with M distinct lenses → synthesize winner + best ideas
- [ ] **loopUntilDry(finders[], maxRounds=5)** — keep spawning finders until K consecutive rounds return nothing new
- [ ] **multiModalSweep(searchAngles[])** — parallel agents each searching different way (by-container, by-content, by-entity, by-time)
- [ ] **completenessCritic(findings[])** — final agent asks "what's missing?" → becomes next round of work
- [ ] **Quality patterns as reusable functions** — no silent caps, log what was dropped

### Implementation Plan
1. **Create `artifacts/api-server/src/lib/orchestration-engine.ts`** — pure TypeScript, no external deps
2. **Export primitives**: `pipeline`, `parallel`, `adversarialVerify`, `judgePanel`, `loopUntilDry`, `multiModalSweep`, `completenessCritic`
3. **Wire into Build Mode** — replace auto-fix with `adversarialVerify(diff, 3)` → if fails, spawn planner for better fix
4. **Wire into Universal Agent (Phase 23)** — orchestrate multi-tool chains with quality gates
5. **Add to tool registry** — `orchestration.pipeline`, `orchestration.parallel`, `orchestration.verify`, `orchestration.judge`

### Files to Create/Modify
- `artifacts/api-server/src/lib/orchestration-engine.ts` (new)
- `artifacts/api-server/src/lib/build-orchestrator.ts` (integrate adversarialVerify in verification loop)
- `artifacts/api-server/src/lib/universal-agent.ts` (integrate pipeline/parallel for multi-tool chains)
- `artifacts/api-server/src/lib/tool-registry.ts` (register orchestration tools)

---

## 📦 Phase 26: Specialized Subagents with Schemas

### Goal
Define **structured-output subagents** with JSON schemas — like Claude Code's `code-reviewer`, `planner`, `researcher` — that can be spawned by the orchestration engine.

### Requirements
- [ ] **Subagent Registry** — `artifacts/api-server/src/lib/subagents.ts` with:
  - `code-reviewer`: finds bugs, security, perf — adversarial, defaults to "broken unless proven"
  - `planner`: decomposes tasks → minimal verifiable steps + risk identification
  - `researcher`: browse → extract → cite — every claim needs source URL
  - `fixer`: targeted repairs with verification
  - `synthesizer`: merges multiple perspectives into coherent output
- [ ] **Structured Output** — each subagent has Zod schema, validated at tool-call layer (retries on mismatch)
- [ ] **Model/Effort Override** — per-subagent model tier (Lite/High/Max) and reasoning effort
- [ ] **Spawn from Orchestration Engine** — `orchestration.spawn(agentType, prompt, schema)`
- [ ] **Perspective-Diverse Verify** — same finding judged by 3 distinct lenses (correctness, security, perf, reproducibility)

### Implementation Plan
1. **Define schemas** in `subagents.ts` using Zod (already in deps)
2. **Create system prompts** optimized for each role
3. **Add `spawnSubagent` to orchestration-engine.ts** — calls chat API with schema enforcement
4. **Wire adversarialVerify to use `code-reviewer` × 3** with different seeds
5. **Wire judgePanel to use `planner` × N + `synthesizer`**

### Files to Create/Modify
- `artifacts/api-server/src/lib/subagents.ts` (new)
- `artifacts/api-server/src/lib/orchestration-engine.ts` (add spawnSubagent)
- `artifacts/api-server/src/lib/orchestration-engine.ts` (adversarialVerify → 3× code-reviewer)

---

## 📦 Phase 27: Virtual Worktrees + Parallel Agent Execution

### Goal
**Isolated filesystem per agent** — enables true parallel execution without conflicts. Browser-native using IndexedDB + OPFS (Origin Private File System).

### Requirements
- [ ] **Virtual Worktree Manager** — `artifacts/api-server/src/lib/virtual-worktree.ts`:
  - `createWorktree(baseCommit)` → isolated FS snapshot (IndexedDB + OPFS)
  - `applyPatch(worktreeId, diff)` → apply changes, return new state
  - `getDiff(worktreeId, baseCommit)` → unified diff
  - `mergeWorktrees(target, sources[])` — three-way merge, conflict detection
  - `listWorktrees()` / `deleteWorktree(id)`
- [ ] **Parallel Agent Runner** — `artifacts/api-server/src/lib/parallel-agents.ts`:
  - Spawn N agents each with own worktree
  - Shared context via `BroadcastChannel` (read-only file map, decisions)
  - Results collected via `Promise.allSettled`
  - Auto-cleanup on completion/error
- [ ] **Integration** — Build Mode: each coder agent gets own worktree; reviewer sees merged diff
- [ ] **Fallback** — if OPFS unavailable, use IndexedDB-only virtual FS

### Implementation Plan
1. **Virtual FS Layer** — wrapper over `navigator.storage.getDirectory()` (OPFS) + IndexedDB fallback
2. **Git-like Operations** — diff/patch using `diff` npm package (already in deps), three-way merge
3. **Agent Isolation** — each agent gets `worktreeId` in `ToolExecutionContext`, all file ops scoped
4. **Build Orchestrator Integration** — `parallelGroups` → each group gets fresh worktree from base
5. **Debug UI** — show worktree status, diffs, conflicts in Build Debug panel

### Files to Create/Modify
- `artifacts/api-server/src/lib/virtual-worktree.ts` (new)
- `artifacts/api-server/src/lib/parallel-agents.ts` (new)
- `artifacts/api-server/src/lib/build-orchestrator.ts` (integrate worktrees for parallel coders)
- `artifacts/jarvis/src/components/debug/` (worktree visualization panel)

---

## 📦 Phase 28: Local Terminal Bridge (node-pty WebSocket)

### Goal
**Real terminal in browser** — WebSocket bridge to `node-pty` running locally. User runs `npx infinity-terminal-bridge` once, gets full shell, git, npm, MCP servers.

### Requirements
- [ ] **Bridge Server** — `artifacts/terminal-bridge/` (new package):
  - `node-pty` spawns `bash`/`zsh`/`fish` with inherited env
  - WebSocket server on `ws://localhost:3001` (configurable)
  - Auth: shared secret from `.infinity/bridge-secret` (generated on first run)
  - Handles multiple sessions (tabs) via session ID
  - Forwards stdin/stdout/stderr, resize, signals
- [ ] **Frontend Terminal** — extend existing `xterm.js` in BuildView:
  - Connect to `ws://localhost:3001?session=<id>&secret=<secret>`
  - Reconnect on disconnect, buffer replay
  - Multiple terminals (tabs) per build
- [ ] **MCP Server Bridge** — same WebSocket exposes MCP stdio transport:
  - Filesystem MCP → bridge → local filesystem
  - Git MCP → bridge → local git
  - SQLite MCP → bridge → local DB
  - Any stdio MCP server works
- [ ] **Zero Config** — `npx infinity-terminal-bridge` auto-generates secret, prints connection URL
- [ ] **Security** — secret rotation, IP allowlist (localhost only), command allowlist optional

### Implementation Plan
1. **Create `artifacts/terminal-bridge/`** — minimal Node.js + `ws` + `node-pty`
2. **Publish to npm** as `infinity-terminal-bridge` (free, public)
3. **Frontend** — `useTerminalBridge` hook in `BuildView`, auto-connect
4. **MCP Integration** — stdio-over-WebSocket adapter in `tool-registry.ts`
5. **Docs** — `TERMINAL_BRIDGE.md` with setup instructions

### Files to Create/Modify
- `artifacts/terminal-bridge/` (new directory — package.json, src/index.ts, bin/bridge.ts)
- `artifacts/jarvis/src/hooks/useTerminalBridge.ts` (new)
- `artifacts/jarvis/src/components/views/BuildView.tsx` (integrate bridge terminal)
- `artifacts/api-server/src/lib/tool-registry.ts` (MCP-over-bridge tools)

---

## 📦 Phase 29: MCP Client + Ecosystem Integration

### Goal
**Browser-native MCP client** — connect to any MCP server (local via terminal bridge, remote via HTTP/SSE). Infinity becomes an MCP *client*, not just a server.

### Requirements
- [ ] **MCP Client** — `artifacts/api-server/src/lib/mcp-client.ts`:
  - Transports: stdio (via terminal bridge), HTTP+SSE, WebSocket
  - `connect(config)` → discovers tools/resources/prompts
  - `callTool(name, args)` → typed invocation with timeout/retry
  - `listTools()` / `listResources()` / `readResource(uri)`
  - Session management (reconnect, capability negotiation)
- [ ] **Registry Integration** — MCP tools auto-registered in Universal Tool Registry with `mcp.` namespace
- [ ] **Built-in Server Configs** — one-click connect to:
  - `filesystem` (via terminal bridge)
  - `github` (OAuth + PAT)
  - `postgres` / `sqlite` / `mysql`
  - `slack` / `discord` / `notion` / `linear` / `jira`
  - `brave-search` / `fetch` / `puppeteer`
- [ ] **Project-Scoped Connections** — each project has its own MCP server configs (encrypted secrets)
- [ ] **UI** — MCP Servers tab in Project Settings: add/remove/test/configure

### Implementation Plan
1. **MCP Client Library** — TypeScript implementation of MCP spec (modelcontextprotocol/sdk types)
2. **Transport Adapters** — stdio-over-bridge, HTTP, SSE, WebSocket
3. **Tool Registry Bridge** — `MCPToolAdapter` wraps MCP tool → `UniversalToolDefinition`
4. **Project Settings UI** — `MCPConfigPanel.tsx` in SettingsView
5. **Secrets Management** — encrypt MCP credentials with project-scoped key

### Files to Create/Modify
- `artifacts/api-server/src/lib/mcp-client.ts` (new)
- `artifacts/api-server/src/lib/mcp-registry.ts` (new — auto-register discovered tools)
- `artifacts/jarvis/src/components/views/SettingsView.tsx` (MCP servers tab)
- `artifacts/api-server/src/routes/jarvis/mcp-servers.ts` (new — CRUD for project MCP configs)

---

## 📦 Phase 30: VS Code Extension (Infinity Build Panel)

### Goal
**Free VS Code Extension** — "Infinity Build" on Marketplace. Sidebar panel with build control, inline diffs, diagnostics, "Send to Infinity" context menu.

### Requirements
- [ ] **Extension Host** — `artifacts/vscode-extension/`:
  - Activates on `infinity.build` command or sidebar click
  - Webview panel loads Infinity Build (localhost or deployed)
  - `vscode.workspace.fs` ↔ Infinity workspace sync (bidirectional)
- [ ] **Features**:
  - **Build Panel** — start/stop build, view plan, diffs, logs, terminal
  - **Inline Diffs** — `vscode.languages.registerInlineEditProvider` for build-studio changes
  - **Diagnostics** — `getDiagnostics` MCP → VS Code Problems panel
  - **Send to Infinity** — right-click file/folder → "Send to Infinity Build" (opens chat with context)
  - **File Sync** — changes in VS Code → Infinity workspace, vice versa
  - **Terminal Bridge** — "Open in Infinity Terminal" → connects to local bridge
- [ ] **Authentication** — VS Code secrets API for API key storage
- [ ] **Free Publish** — VS Code Marketplace (no cost)
- [ ] **Auto-Update** — GitHub Releases + `@vscode/extension-auto-update`

### Implementation Plan
1. **Scaffold Extension** — `yo code` → TypeScript + Webview
2. **Webview Communication** — `postMessage` API for build control, file sync
3. **File System Provider** — optional: mount Infinity workspace as virtual FS
4. **Diagnostics Pipeline** — MCP `diagnostics` tool → VS Code markers
5. **Marketplace Publish** — `vsce package` → `vsce publish` (free)

### Files to Create/Modify
- `artifacts/vscode-extension/` (new — full extension)
- `artifacts/api-server/src/lib/mcp-tools/diagnostics.ts` (MCP tool for diagnostics)
- `artifacts/jarvis/src/components/views/BuildView.tsx` (extension messaging API)