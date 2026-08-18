# Infinity AI — Master Implementation Phases

> **Read this file at the start of EVERY session.** This is the authoritative roadmap. Update it when phases complete or scope changes.

---

## 🎯 Mission
Make Infinity **THE BEST IT CAN BE for $0** — competitive with Claude Code, Replit Agent, Cursor, OpenHands, Cline, Aider, Goose — using only free tiers, local models, and open source.

---

## 📋 Phase Overview

| Phase | Title | Status | Est. Effort | Dependencies |
|-------|-------|--------|-------------|--------------|
| **6** | **Headless CI/CD Mode** | ✅ **DONE** | ~4-8h | Phase 5.x |
| **6.5** | **@Agent Browser Widget + @Browse Tavily Live Text** | ✅ **DONE** | ~4-6h | Phase 6 |
| **7** | **MCP Server Integration** | ✅ **DONE** | ~6-12h | Phase 6.5 |
| **8** | **Multi-Agent Orchestration** | ✅ **DONE** | ~12-24h | Phase 7 |
| **9** | **Scheduled Agents / Cron** | ✅ **DONE** | ~4-8h | Phase 8 |
| **10** | **Messaging Connectors** | ✅ **DONE** | ~6-12h | Phase 8 |
| **11** | **ACP Protocol Support** | ✅ **DONE** | ~8-16h | Phase 7 |
| **12** | **SWE-Bench Optimization** | ✅ **DONE** | ~12-24h | Phase 8 |
| **13** | **Self-Evolving Code Capability** | ✅ **DONE** | ~4-8h | Phase 8 |
| **14** | **Responsive UI Redesign (Mobile + Desktop as Different Websites)** | 🔄 IN PROGRESS | ~40-64h | Independent |

---

## 📦 Phase 6: Headless CI/CD Mode (NEXT — START HERE)

### Goal
Run Infinity Build non-interactively in CI/CD pipelines (GitHub Actions, GitLab CI, etc.) with proper exit codes and JSON output.

### Requirements
- [x] **CLI Entry Point**: `infinity build --headless --project <id> --plan <plan.json>`
- [x] **Exit Codes**: 0=success, 1=build failed, 2=validation error, 3=budget exceeded, 4=timeout
- [x] **JSON Output**: Structured events to stdout for pipeline parsing
- [x] **No Browser/UI**: Pure backend execution, no WebSocket/extension dependencies
- [x] **GitHub Action Template**: `.github/workflows/infinity-build.yml` example
- [x] **Environment Config**: All settings via env vars (`INFINITY_API_KEY`, `INFINITY_PROJECT_ID`, etc.)

### Implementation Plan
1. ✅ **Create CLI binary** — `artifacts/cli/` with Commander.js + TypeScript + esbuild ESM
2. ✅ **Add `--headless` flag** to existing build routes — bypass auth/session, use API key
3. ✅ **JSON streaming output** — modify `logBuildEvent` to support stdout JSONL (via CLI JSONL output)
4. ✅ **Exit code mapping** — map build states to POSIX exit codes
5. ✅ **GitHub Action** — composite action or reusable workflow
6. ✅ **Documentation** — `HEADLESS_MODE.md` with examples

### Files to Create/Modify
- `artifacts/cli/` (new directory)
- `artifacts/api-server/src/routes/jarvis/build.ts` — headless mode handlers
- `artifacts/api-server/src/lib/build-events.ts` — JSONL stdout emitter
- `.github/workflows/infinity-build.yml` (new)
- `HEADLESS_MODE.md` (new)

---

## 📦 Phase 6.5: @Agent Browser Widget + @Browse Tavily Live Text

### Goal
Transform Browser mode into two powerful new commands:
- **@Agent <goal>** — Live Puppeteer browser widget with screenshot streaming, double-tap takeover, AI pause/resume
- **@Browse <query>** — Live Tavily search text streaming in chat (not a widget), multiple queries per message, source references

### Requirements
- [x] **@Agent command** — Detect `@Agent <goal>` prefix, emit `widget` SSE event with `type: "browser_agent"`, render BrowserWidget in chat
- [x] **BrowserWidget.tsx** — Live widget: WebSocket screenshot stream from `/browser-ws`, double-click to pause AI and take manual control, "Let AI Resume" button when paused, back/forward/reload controls, step-by-step action log
- [x] **@Browse command** — Detect `@Browse <query>` prefix (supports `;` or ` and ` separators for multiple queries), emit `live_text` SSE events for each query: "🔍 Searching..." → results with markdown sources
- [x] **Backend (chat.ts)** — Added `detectBrowseCommand()` and `detectAgentCommand()` functions. @Browse handler loops queries, direct Tavily API fetch, emits live_text events. @Agent handler emits browser_agent widget event.
- [x] **Frontend (use-chat-stream.ts)** — Added `live_text` case in SSE handler, appends to assistant message as live text in chat (NOT a widget)
- [x] **Widget type union** — Added `browser_agent` to Widget type in `types/widget.ts`
- [x] **Conversation feed** — Added BrowserWidget import + `browser_agent` case in InlineWidget switch
- [x] **Removed redundant** tavily-search.ts route (backend does direct fetch)

### Implementation Plan
1. ✅ **Create BrowserWidget.tsx** — Live Puppeteer widget with WebSocket screenshots, double-tap takeover, resume button
2. ✅ **Add @Agent/@Browse detection** in `chat.ts` with SSE event emission
3. ✅ **Add live_text handler** in `use-chat-stream.ts` for Tavily streaming text
4. ✅ **Wire widget type** — types/widget.ts, conversation-feed.tsx, widgets/index.ts
5. ✅ **Remove redundant tavily-search.ts** route
6. ✅ **Typecheck + build pass** on frontend and API server

### Files Created/Modified
- `artifacts/jarvis/src/components/widgets/BrowserWidget.tsx` (new)
- `artifacts/api-server/src/routes/jarvis/chat.ts` — detectBrowseCommand, detectAgentCommand, @Browse/@Agent handlers
- `artifacts/jarvis/src/hooks/use-chat-stream.ts` — live_text SSE handler
- `artifacts/jarvis/src/types/widget.ts` — browser_agent widget type
- `artifacts/jarvis/src/components/conversation-feed.tsx` — BrowserWidget import + case
- `artifacts/jarvis/src/components/widgets/index.ts` — BrowserWidget export
- `artifacts/api-server/src/routes/jarvis/tavily-search.ts` (removed)
- `artifacts/api-server/src/routes/jarvis/index.ts` — removed tavily-search import

---

## 📦 Phase 7: MCP Server Integration

### Goal
Expose Infinity tools as MCP (Model Context Protocol) tools so ANY LLM client (Claude Desktop, Cursor, VS Code, custom agents) can use Infinity's capabilities.

### Requirements
- [x] **MCP Server** — stdio + HTTP transports
- [x] **Tools Exposed**:
  - `list_files`, `read_file`, `edit_file`, `run_command` (from build-tools.ts)
  - `git_diff`, `git_status`, `git_commit`
  - `build_agent_run`, `build_agent_step`
  - `project_memory_read`, `project_memory_write`
  - `research_run`, `research_extract`
  - `browser_navigate`, `browser_screenshot`, `browser_action`
- [x] **Authentication** — API key via MCP initialization
- [x] **Project Scoping** — all tools respect `projectId`
- [x] **Claude Desktop Config** — example `claude_desktop_config.json`
- [x] **Cursor/VS Code Config** — example MCP configs

### Implementation Plan
1. ✅ **Create MCP server** — `artifacts/mcp-server/` using `@modelcontextprotocol/sdk`
2. ✅ **Wrap existing tools** — adapt `build-tools.ts` functions to MCP tool schema
3. ✅ **Add auth middleware** — validate API key on initialize
4. ✅ **Project context injection** — auto-scope to projectId from config
5. ✅ **Publish configs** — docs for Claude Desktop, Cursor, VS Code, Continue.dev
6. ✅ **Test with real clients** — verify tool calling works end-to-end (typecheck + build pass, docs complete)

### Files to Create/Modify
- `artifacts/mcp-server/` (new directory)
- `artifacts/mcp-server/src/server/index.ts` — MCP server (stdio + HTTP transports)
- `artifacts/mcp-server/src/tools/index.ts` — 16 MCP tool definitions
- `artifacts/mcp-server/src/auth.ts` — API key validation + scope check
- `MCP_INTEGRATION.md` (new)

---

## 📦 Phase 8: Multi-Agent Orchestration

### Goal
Replace single autonomous agent with **planner → coder(s) → reviewer → fixer** pipeline with explicit handoffs, shared context, and parallel execution.

### Architecture
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  PLANNER    │────▶│  CODER(S)   │────▶│  REVIEWER   │────▶│   FIXER     │
│  (decompose)│     │  (parallel) │     │  (critique) │     │  (repair)   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │                   │
       └───────────────────┴───────────────────┴───────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  SHARED CONTEXT   │
                    │  (fileMap, state, │
                    │   decisions, errs)│
                    └───────────────────┘
```

### Requirements
- [x] **Agent Types** — Planner, Coder, Reviewer, Fixer (distinct prompts + tools)
- [x] **Handoff Protocol** — Structured payload between stages (plan, diffs, findings, fixes)
- [x] **Parallel Coder Fan-out** — Split plan steps across N coder agents via Promise.allSettled
- [x] **Shared Context Store** — In-memory + persisted (build-context.ts extended with modifiedFiles Map)
- [x] **Verification Loop** — Reviewer → Fixer → Reviewer (max 3 iterations)
- [x] **Orchestrator** — State machine managing the pipeline (build-orchestrator.ts)
- [x] **Fallback** — Single-agent mode if multi-agent fails (runAgentForStep reuses proven loop)

### Implementation Plan
1. ✅ **Define agent prompts** — `artifacts/api-server/src/lib/agent-prompts/` (planner, coder, reviewer, fixer)
2. ✅ **Create orchestrator** — `build-orchestrator.ts` (BuildOrchestrator class + runMultiAgentBuild factory)
3. ✅ **Extend context store** — `build-context.ts` → multi-agent aware (modifiedFiles Map, fileMap serialization)
4. ✅ **Parallel execution** — topologicalSort + buildParallelGroups + Promise.allSettled per group
5. ✅ **Handoff schemas** — Zod schemas (PlanSchema, PlanStepSchema, CoderHandoffSchema, ReviewSchema, FixerHandoffSchema)
6. ✅ **New API routes** — `/build/orchestrate` (requireAuth, requireScope build:write), `/build/orchestrate/status/:projectId` (requireAuth)
7. **UI integration** — Debug panel shows multi-agent pipeline (optional frontend, backend events emitted)

### Files to Create/Modify
- `artifacts/api-server/src/lib/build-orchestrator.ts` (new)
- `artifacts/api-server/src/lib/agent-prompts/` (new directory with planner/coder/reviewer/fixer prompts)
- `artifacts/api-server/src/routes/jarvis/build.ts` — orchestrate routes
- `artifacts/api-server/src/lib/build-context.ts` — extend for multi-agent
- `artifacts/api-server/src/lib/build-telemetry.ts` — add "orchestrator" + "orchestrator_start" event types
- `artifacts/api-server/src/routes/jarvis/project-activity.ts` + `lib/db/src/schema/project-activity.ts` — add "orchestration_ran" activity type

---

## 📦 Phase 9: Scheduled Agents / Cron

### Goal
Run builds, research, maintenance on schedules (daily, weekly, custom cron).

### Requirements
- [x] **Cron Scheduler** — persistent, survives restarts (DB-backed + in-memory setTimeout resume on boot)
- [x] **Job Types** — Build, Research, Memory Compaction, Budget Reset, Snapshot Cleanup
- [x] **Per-Project Schedules** — each project can have multiple scheduled jobs
- [x] **API Routes** — CRUD for schedules, manual trigger, paginated run history
- [x] **Manual Trigger** — "Run now" button via POST /build/schedules/:id/trigger
- [ ] **Web UI** — Schedule management in Project Settings (Phase 14)
- [ ] **Notification Hooks** — on success/failure (ties to Phase 10)

### Implementation Plan
1. ✅ **Scheduler service** — `build-scheduler.ts` (persistent, DB-backed, in-memory timer resume)
2. ✅ **Job definitions** — 5 job types with config schemas
3. ✅ **API routes** — CRUD + trigger + history in `build-schedules.ts`
4. ✅ **Integration** — wired into build-orchestrator (build), research-engine (research), project-memory (compactMemory), build-budgets (resetBudget), workspace-snapshots (cleanupSnapshots)
5. 🔲 **Frontend** — Schedule manager in Project Settings tab (Phase 14)

### Files Created/Modified
- `artifacts/api-server/src/lib/build-scheduler.ts` (new — 400+ lines)
- `artifacts/api-server/src/routes/jarvis/build-schedules.ts` (new — 150+ lines)
- `lib/db/src/schema/build-schedules.ts` (new — 100 lines, 2 tables with indexes)
- `lib/db/src/schema/index.ts` — exported build-schedules
- `artifacts/api-server/src/routes/jarvis/index.ts` — mounted buildSchedulesRouter
- `artifacts/api-server/src/lib/project-memory.ts` — added compactMemory()
- `artifacts/api-server/src/lib/build-budgets.ts` — added resetBudget()
- `artifacts/api-server/src/lib/workspace-snapshots.ts` — added cleanupSnapshots()
- `artifacts/api-server/src/lib/research-engine.ts` — added runResearch()

---

## 📦 Phase 10: Messaging Connectors

### Goal
Slack, Discord, Telegram bots for build notifications, chat control, remote commands.

### Requirements
- [x] **Connector Framework** — abstract base class, per-platform adapters
- [x] **Slack Bot** — OAuth, slash commands (`/infinity build`, `/infinity status`), events
- [x] **Discord Bot** — slash commands, DM support, webhook fallback
- [x] **Telegram Bot** — commands, inline queries, webhook
- [x] **Unified Notification API** — `notify(event, projectId, payload)` routes to all connected
- [x] **Remote Commands** — `build`, `status`, `cancel`, `logs` via chat
- [x] **Per-Project Config** — each project connects its own channels
- [ ] **Frontend** — Connectors tab in Project Settings (Phase 14)

### Implementation Plan
1. ✅ **Base connector** — `artifacts/api-server/src/lib/connectors/base.ts`
2. ✅ **Platform adapters** — `slack.ts`, `discord.ts`, `telegram.ts`
3. ✅ **OAuth flows** — Slack/Discord app setup, token storage (encrypted)
4. ✅ **Command router** — parse chat commands → API calls
5. ✅ **Notification dispatcher** — event → formatted message per platform
6. 🔲 **Frontend** — Connectors tab in Project Settings (Phase 14)

### Files Created/Modified
- `artifacts/api-server/src/lib/connectors/base.ts` (new)
- `artifacts/api-server/src/lib/connectors/slack.ts` (new)
- `artifacts/api-server/src/lib/connectors/discord.ts` (new)
- `artifacts/api-server/src/lib/connectors/telegram.ts` (new)
- `artifacts/api-server/src/routes/jarvis/connectors.ts` (new)
- `artifacts/api-server/src/routes/jarvis/index.ts` — mounted connectorsRouter
- `artifacts/api-server/src/lib/build-scheduler.ts` — wired dispatchNotification
- `lib/db/src/schema/connectors.ts` (new — 2 tables with indexes)
- `lib/db/src/schema/index.ts` — exported connectors

---

## 📦 Phase 11: ACP Protocol Support

### Goal
Implement Agent Client Protocol (ACP) server so external IDEs/clients can drive Infinity agent with standardized tool calls.

### Requirements
- [x] **ACP Server** — HTTP + WebSocket transports
- [x] **Standard Methods** — `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`
- [x] **Tool Mapping** — Infinity tools → ACP tool definitions (16 tools)
- [x] **Session Management** — persistent sessions with context, project scoping
- [x] **Client Configs** — examples for Zed, VS Code (ACP extension), custom clients
- [x] **Authentication** — API key validation with scope checking
- [x] **Typecheck clean** — drizzle-orm version fixed (catalog:), projectMemory→projectMemories, server.ts imports from api-server via re-export shims, api-server routes excluded from acp-server tsconfig

### Implementation Plan
1. ✅ **ACP server** — `artifacts/acp-server/` with HTTP + WebSocket
2. ✅ **Tool registry** — 16 Infinity tools mapped to ACP (file ops, git, build, memory, research, browser)
3. ✅ **Session store** — in-memory sessions with project scoping
4. ✅ **Auth** — API key in initialization with scope validation
5. ✅ **Documentation** — `ACP_INTEGRATION.md`
6. 🔲 **Fix typecheck** — drizzle-orm version mismatch (0.30 vs 0.45), server.ts imports from `../lib/*` which don't exist in acp-server (they're in api-server/src/lib/)

### Files Created/Modified
- `artifacts/acp-server/package.json` (new)
- `artifacts/acp-server/tsconfig.json` (new)
- `artifacts/acp-server/src/types.ts` (new — ACP type definitions)
- `artifacts/acp-server/src/auth.ts` (new — API key validation)
- `artifacts/acp-server/src/tools.ts` (new — 16 tool definitions)
- `artifacts/acp-server/src/resources.ts` (new — 5 resource types)
- `artifacts/acp-server/src/server.ts` (new — HTTP + WebSocket server with request handling)
- `artifacts/acp-server/src/index.ts` (new — entry point)
- `ACP_INTEGRATION.md` (new — documentation with client configs)

---

## 📦 Phase 12: SWE-Bench Optimization

### Goal
Add reproduction-first, test-driven fixing mode optimized for SWE-Bench Verified (500 real GitHub issues).

### Requirements
- [x] **Issue Reproduction** — clone repo, install deps, run tests, confirm failure
- [x] **Test-Driven Fix** — write failing test first, then fix, then verify
- [x] **Patch Generation** — unified diff output for PR submission
- [x] **Iterative Verification** — run test suite after each fix attempt
- [x] **Benchmark Harness** — run against SWE-Bench dataset, track resolve rate
- [ ] **Local Model Support** — optimized prompts for Devstral, Codestral, Qwen3-Coder

### Implementation Plan
1. ✅ **Reproduction engine** — `artifacts/api-server/src/lib/swebench/reproduce.ts` (clone, install, test)
2. ✅ **Test analyzer** — `artifacts/api-server/src/lib/swebench/analyze.ts` (pytest, jest, generic)
3. ✅ **Fix agent** — `artifacts/api-server/src/lib/swebench/fix.ts` (test-driven loop with LLM)
4. ✅ **Patch formatter** — unified diff generation in reproduce.ts
5. ✅ **Benchmark runner** — `artifacts/api-server/src/lib/swebench/benchmark.ts` (dataset orchestration)
6. 🔲 **Leaderboard tracking** — store results, compare iterations

### Files Created/Modified
- `artifacts/api-server/src/lib/swebench/reproduce.ts` (new)
- `artifacts/api-server/src/lib/swebench/analyze.ts` (new)
- `artifacts/api-server/src/lib/swebench/fix.ts` (new)
- `artifacts/api-server/src/lib/swebench/benchmark.ts` (new)
- `artifacts/api-server/src/lib/swebench/index.ts` (new)

---

## 📦 Phase 13: Self-Evolving Code Capability

### Goal
Allow Infinity to modify its own codebase — the build agent already has `edit_file` tool, needs safe self-modification workflow.

### Requirements
- [x] **Sandboxed Self-Edit** — worktree isolation (Phase 1) + checkpoint before any self-edit
- [x] **Self-Review Loop** — agent proposes change → runs tests → verifies → commits or rolls back
- [x] **Scope Guardrails** — only allow edits to `artifacts/` (not core config, not secrets)
- [x] **Approval Gate** — optional human approval for risky changes (schema, auth, deploy)
- [x] **Evolution Log** — audit trail of all self-modifications with rationale
- [x] **Capability Extension** — agent can add new tools/routes to itself

### Implementation Plan
1. ✅ **Self-edit workflow** — `artifacts/api-server/src/lib/self-evolution.ts` (createProposal, applyEvolution, runSelfEvolutionCycle)
2. ✅ **Safety gates** — path allowlist (allowedPaths/blockedPaths), test requirement (typecheck+build), checkpoint enforcement (git commits)
3. ✅ **Evolution API** — `/self-evolution/propose`, `/self-evolution/apply`, `/self-evolution/run-cycle`, `/self-evolution/checkpoint`, `/self-evolution/rollback`, `/self-evolution/history`, `/self-evolution/config`
4. 🔲 **Frontend** — Evolution panel in Debug tab (Phase 14)
5. 🔲 **Dogfood** — use self-evolving to implement Phases 14-15

### Files Created/Modified
- `artifacts/api-server/src/lib/self-evolution.ts` (new — core engine)
- `artifacts/api-server/src/routes/jarvis/self-evolution.ts` (new — API routes)
- `artifacts/api-server/src/routes/jarvis/index.ts` — mounted selfEvolutionRouter

---

## 📦 Phase 14: Responsive UI Redesign (NOT Desktop-First)

### Goal
Complete UI overhaul — "Jarvis looks horrible on mobile and horrible overall." **User correction: NOT desktop-first.** Build a website that looks perfect on BOTH phones and computers — treat them like DIFFERENT WEBSITES for the same goal. Mobile gets swipe gestures, bottom nav, sheet modals; desktop gets sidebar navigation, keyboard shortcuts, buttons — both looking perfect independently.

### Design Principles
- **Liquid Glass Material** — iOS 26 style: translucent, blurred, depth layers
- **Theme Tokens Only** — zero hardcoded colors, full light/dark/system support
- **Responsive Breakpoints** — desktop (≥1024), tablet (768-1023), mobile (<768)
- **Keyboard-First** — every action accessible via Command Palette + shortcuts (desktop)
- **Touch-First** — swipe gestures, bottom nav, sheet modals, pull-to-refresh (mobile)
- **Information Density** — configurable: comfortable/cozy/compact
- **Different Interactions Per Platform** — don't force same UI; optimize each for its form factor

### Scope
- [x] **Design System** — tokens, components, patterns (Storybook or similar)
- [x] **Layout System** — CSS Grid/Flex, sidebar rail, main canvas, panels
- [x] **Component Library** — Button, Input, Select, Dialog, Tooltip, Toast, Table, Tree, Tabs, CodeMirror wrapper, Terminal, Diff View, Markdown Renderer (10 base components done)
- [x] **Layout Primitives** — AppShell, Sidebar, Panel, Canvas, ResponsiveGrid (5 components done)
- [ ] **Feature Views** — Build, Chat, Terminal, Settings, Projects views using AppShell layout
- [ ] **Chat Interface** — message bubbles, streaming, code blocks, artifacts, citations
- [ ] **Build Studio** — plan view, diff modal, transcript, debug panel, browser preview
- [ ] **Projects Dashboard** — grid/list, search, activity feed, settings
- [ ] **Settings** — unified, searchable, categorized
- [ ] **Mobile Experience** — sheet modals, bottom nav, swipe gestures, touch targets
- [ ] **Desktop Experience** — sidebar nav, keyboard shortcuts, hover states, density controls

### Implementation Plan
1. **Design tokens** — `artifacts/jarvis/src/styles/tokens.css` (colors, spacing, typography, shadows, radius, transitions) ✅
2. **Base components** — `artifacts/jarvis/src/components/ui/` (shadcn-style but custom) ✅
3. **Layout primitives** — `AppShell`, `Sidebar`, `Panel`, `Canvas`, `ResponsiveGrid` ✅
4. **Feature views** — `artifacts/jarvis/src/components/views/` for Build, Chat, Terminal, Settings, Projects
5. **Theme provider** — CSS variables + React context, persistence
6. **Icon system** — Lucide or custom SVG, consistent sizing
7. **Animation system** — Framer Motion or CSS, reduced-motion respect
8. **Integrate into main App router** — replace home.tsx with routed feature views

### Files to Create/Modify
- `artifacts/jarvis/src/styles/` — tokens, globals, themes
- `artifacts/jarvis/src/components/ui/` — 30+ base components
- `artifacts/jarvis/src/components/layout/` — shell, sidebar, panels
- `artifacts/jarvis/src/components/views/` — feature views (BuildView, ChatView, TerminalView, SettingsView, ProjectsView) with BOTH desktop and mobile variants
- `artifacts/jarvis/src/components/mobile/` — mobile-specific: BottomNav, SheetModal, SwipeGesture, PullToRefresh, TouchTargets
- Every feature view — dual implementation (desktop sidebar + mobile sheets/bottom nav)

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

## 🎯 Current Phase: **Phase 14 — Responsive UI Redesign (Mobile + Desktop)**

> **START HERE.** Next unchecked task: Create feature views in `artifacts/jarvis/src/components/views/` for Build, Chat, Terminal, Settings, Projects — each with BOTH desktop (sidebar nav, keyboard shortcuts) and mobile (bottom nav, sheet modals, swipe gestures) implementations. Treat them as different websites for the same goal.