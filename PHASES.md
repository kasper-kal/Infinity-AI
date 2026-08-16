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
| **7** | **MCP Server Integration** | 🔄 **IN PROGRESS** | ~6-12h | Phase 6 |
| **8** | **Multi-Agent Orchestration** | ⏳ PENDING | ~12-24h | Phase 7 |
| **9** | **Scheduled Agents / Cron** | ⏳ PENDING | ~4-8h | Phase 8 |
| **10** | **Messaging Connectors** | ⏳ PENDING | ~6-12h | Phase 8 |
| **11** | **ACP Protocol Support** | ⏳ PENDING | ~8-16h | Phase 7 |
| **12** | **SWE-Bench Optimization** | ⏳ PENDING | ~12-24h | Phase 8 |
| **13** | **Self-Evolving Code Capability** | ⏳ PENDING | ~4-8h | Phase 8 |
| **14** | **Desktop-First Redesign** | ⏳ PENDING | ~24-40h | Independent |
| **15** | **Mobile as Separate Website** | ⏳ PENDING | ~16-24h | Phase 14 |

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

## 📦 Phase 7: MCP Server Integration

### Goal
Expose Infinity tools as MCP (Model Context Protocol) tools so ANY LLM client (Claude Desktop, Cursor, VS Code, custom agents) can use Infinity's capabilities.

### Requirements
- [ ] **MCP Server** — stdio + HTTP transports
- [ ] **Tools Exposed**:
  - `list_files`, `read_file`, `edit_file`, `run_command` (from build-tools.ts)
  - `git_diff`, `git_status`, `git_commit`
  - `build_agent_run`, `build_agent_step`
  - `project_memory_read`, `project_memory_write`
  - `research_run`, `research_extract`
  - `browser_navigate`, `browser_screenshot`, `browser_action`
- [ ] **Authentication** — API key via MCP initialization
- [ ] **Project Scoping** — all tools respect `projectId`
- [ ] **Claude Desktop Config** — example `claude_desktop_config.json`
- [ ] **Cursor/VS Code Config** — example MCP configs

### Implementation Plan
1. **Create MCP server** — `artifacts/mcp-server/` using `@modelcontextprotocol/sdk`
2. **Wrap existing tools** — adapt `build-tools.ts` functions to MCP tool schema
3. **Add auth middleware** — validate API key on initialize
4. **Project context injection** — auto-scope to projectId from config
5. **Publish configs** — docs for Claude Desktop, Cursor, VS Code, Continue.dev
6. **Test with real clients** — verify tool calling works end-to-end

### Files to Create/Modify
- `artifacts/mcp-server/` (new directory)
- `artifacts/mcp-server/src/tools/` — MCP tool definitions
- `artifacts/mcp-server/src/auth.ts` — API key validation
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
- [ ] **Agent Types** — Planner, Coder, Reviewer, Fixer (distinct prompts + tools)
- [ ] **Handoff Protocol** — Structured payload between stages (plan, diffs, findings, fixes)
- [ ] **Parallel Coder Fan-out** — Split plan steps across N coder agents
- [ ] **Shared Context Store** — In-memory + persisted (build-context.ts extended)
- [ ] **Verification Loop** — Reviewer → Fixer → Reviewer (max 3 iterations)
- [ ] **Orchestrator** — State machine managing the pipeline
- [ ] **Fallback** — Single-agent mode if multi-agent fails

### Implementation Plan
1. **Define agent prompts** — `artifacts/api-server/src/lib/agent-prompts/`
2. **Create orchestrator** — `build-orchestrator.ts` (state machine)
3. **Extend context store** — `build-context.ts` → multi-agent aware
4. **Parallel execution** — use `Promise.allSettled` for coder fan-out
5. **Handoff schemas** — Zod schemas for each stage payload
6. **New API routes** — `/build/orchestrate`, `/build/orchestrate/status`
7. **UI integration** — Debug panel shows multi-agent pipeline

### Files to Create/Modify
- `artifacts/api-server/src/lib/build-orchestrator.ts` (new)
- `artifacts/api-server/src/lib/agent-prompts/` (new directory)
- `artifacts/api-server/src/routes/jarvis/build.ts` — orchestrate routes
- `artifacts/api-server/src/lib/build-context.ts` — extend for multi-agent

---

## 📦 Phase 9: Scheduled Agents / Cron

### Goal
Run builds, research, maintenance on schedules (daily, weekly, custom cron).

### Requirements
- [ ] **Cron Scheduler** — persistent, survives restarts (use existing `CronCreate` pattern)
- [ ] **Job Types** — Build, Research, Memory Compaction, Budget Reset, Snapshot Cleanup
- [ ] **Per-Project Schedules** — each project can have multiple scheduled jobs
- [ ] **Web UI** — Schedule management in Project Settings
- [ ] **Notification Hooks** — on success/failure (ties to Phase 10)
- [ ] **Manual Trigger** — "Run now" button

### Implementation Plan
1. **Scheduler service** — `build-scheduler.ts` (persistent, DB-backed)
2. **Job definitions** — Zod schemas for each job type
3. **API routes** — CRUD for schedules, manual trigger, history
4. **Frontend** — Schedule manager in Project Settings tab
5. **Integration** — wire into build-orchestrator, research system

### Files to Create/Modify
- `artifacts/api-server/src/lib/build-scheduler.ts` (new)
- `artifacts/api-server/src/routes/jarvis/build-schedules.ts` (new)
- Frontend: Project Settings → Schedules section

---

## 📦 Phase 10: Messaging Connectors

### Goal
Slack, Discord, Telegram bots for build notifications, chat control, remote commands.

### Requirements
- [ ] **Connector Framework** — abstract base class, per-platform adapters
- [ ] **Slack Bot** — OAuth, slash commands (`/infinity build`, `/infinity status`), events
- [ ] **Discord Bot** — slash commands, DM support, webhook fallback
- [ ] **Telegram Bot** — commands, inline queries, webhook
- [ ] **Unified Notification API** — `notify(event, projectId, payload)` routes to all connected
- [ ] **Remote Commands** — `build`, `status`, `cancel`, `logs` via chat
- [ ] **Per-Project Config** — each project connects its own channels

### Implementation Plan
1. **Base connector** — `artifacts/api-server/src/lib/connectors/base.ts`
2. **Platform adapters** — `slack.ts`, `discord.ts`, `telegram.ts`
3. **OAuth flows** — Slack/Discord app setup, token storage (encrypted)
4. **Command router** — parse chat commands → API calls
5. **Notification dispatcher** — event → formatted message per platform
6. **Frontend** — Connectors tab in Project Settings

### Files to Create/Modify
- `artifacts/api-server/src/lib/connectors/` (new directory)
- `artifacts/api-server/src/routes/jarvis/connectors.ts` (new)
- Frontend: Project Settings → Connectors

---

## 📦 Phase 11: ACP Protocol Support

### Goal
Implement Agent Client Protocol (ACP) server so external IDEs/clients can drive Infinity agent with standardized tool calls.

### Requirements
- [ ] **ACP Server** — HTTP + WebSocket transports
- [ ] **Standard Methods** — `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`
- [ ] **Tool Mapping** — Infinity tools → ACP tool definitions
- [ ] **Session Management** — persistent sessions with context
- [ ] **Client Configs** — examples for Zed, VS Code (ACP extension), custom clients

### Implementation Plan
1. **ACP server** — `artifacts/acp-server/` using ACP spec
2. **Tool registry** — map build-tools + project tools to ACP
3. **Session store** — per-client context, project scoping
4. **Auth** — API key in initialization
5. **Documentation** — `ACP_INTEGRATION.md`

### Files to Create/Modify
- `artifacts/acp-server/` (new directory)
- `ACP_INTEGRATION.md` (new)

---

## 📦 Phase 12: SWE-Bench Optimization

### Goal
Add reproduction-first, test-driven fixing mode optimized for SWE-Bench Verified (500 real GitHub issues).

### Requirements
- [ ] **Issue Reproduction** — clone repo, install deps, run tests, confirm failure
- [ ] **Test-Driven Fix** — write failing test first, then fix, then verify
- [ ] **Patch Generation** — unified diff output for PR submission
- [ ] **Iterative Verification** — run test suite after each fix attempt
- [ ] **Benchmark Harness** — run against SWE-Bench dataset, track resolve rate
- [ ] **Local Model Support** — optimized prompts for Devstral, Codestral, Qwen3-Coder

### Implementation Plan
1. **Reproduction engine** — `swebench-reproduce.ts` (Docker/isolated env)
2. **Test analyzer** — parse test output, identify failing tests
3. **Fix agent** — specialized prompt for test-driven fixing
4. **Patch formatter** — generate proper git diff
5. **Benchmark runner** — orchestrate full SWE-Bench evaluation
6. **Leaderboard tracking** — store results, compare iterations

### Files to Create/Modify
- `artifacts/api-server/src/lib/swebench/` (new directory)
- `SWE_BENCH_MODE.md` (new)

---

## 📦 Phase 13: Self-Evolving Code Capability

### Goal
Allow Infinity to modify its own codebase — the build agent already has `edit_file` tool, needs safe self-modification workflow.

### Requirements
- [ ] **Sandboxed Self-Edit** — worktree isolation (Phase 1) + checkpoint before any self-edit
- [ ] **Self-Review Loop** — agent proposes change → runs tests → verifies → commits or rolls back
- [ ] **Scope Guardrails** — only allow edits to `artifacts/` (not core config, not secrets)
- [ ] **Approval Gate** — optional human approval for risky changes (schema, auth, deploy)
- [ ] **Evolution Log** — audit trail of all self-modifications with rationale
- [ ] **Capability Extension** — agent can add new tools/routes to itself

### Implementation Plan
1. **Self-edit workflow** — extend `build-orchestrator` with self-modification mode
2. **Safety gates** — path allowlist, test requirement, checkpoint enforcement
3. **Evolution API** — `/build/self-edit/propose`, `/build/self-edit/apply`, `/build/self-edit/history`
4. **Frontend** — Evolution panel in Debug tab
5. **Dogfood** — use self-evolving to implement Phases 14-15

### Files to Create/Modify
- `artifacts/api-server/src/lib/self-evolution.ts` (new)
- `artifacts/api-server/src/routes/jarvis/self-evolution.ts` (new)
- Frontend: Debug panel → Evolution tab

---

## 📦 Phase 14: Desktop-First Redesign

### Goal
Complete UI overhaul — "Jarvis looks horrible on mobile and horrible overall." Desktop-first, then mobile as separate site.

### Design Principles
- **Liquid Glass Material** — iOS 26 style: translucent, blurred, depth layers
- **Theme Tokens Only** — zero hardcoded colors, full light/dark/system support
- **Responsive Breakpoints** — desktop (≥1024), tablet (768-1023), mobile (<768)
- **Keyboard-First** — every action accessible via Command Palette + shortcuts
- **Information Density** — configurable: comfortable/cozy/compact

### Scope
- [ ] **Design System** — tokens, components, patterns (Storybook or similar)
- [ ] **Layout System** — CSS Grid/Flex, sidebar rail, main canvas, panels
- [ ] **Component Library** — Button, Input, Select, Dialog, Tooltip, Toast, Table, Tree, Tabs, CodeMirror wrapper, Terminal, Diff View, Markdown Renderer
- [ ] **Chat Interface** — message bubbles, streaming, code blocks, artifacts, citations
- [ ] **Build Studio** — plan view, diff modal, transcript, debug panel, browser preview
- [ ] **Projects Dashboard** — grid/list, search, activity feed, settings
- [ ] **Settings** — unified, searchable, categorized
- [ ] **Mobile Breakpoints** — hide complex panels, stack layouts, touch targets

### Implementation Plan
1. **Design tokens** — `artifacts/jarvis/src/styles/tokens.css` (colors, spacing, typography, shadows, radius, transitions)
2. **Base components** — `artifacts/jarvis/src/components/ui/` (shadcn-style but custom)
3. **Layout primitives** — `AppShell`, `Sidebar`, `Panel`, `Canvas`, `ResponsiveGrid`
4. **Feature components** — migrate each view to new system
5. **Theme provider** — CSS variables + React context, persistence
6. **Icon system** — Lucide or custom SVG, consistent sizing
7. **Animation system** — Framer Motion or CSS, reduced-motion respect

### Files to Create/Modify
- `artifacts/jarvis/src/styles/` — tokens, globals, themes
- `artifacts/jarvis/src/components/ui/` — 30+ base components
- `artifacts/jarvis/src/components/layout/` — shell, sidebar, panels
- Every feature view — incremental migration

---

## 📦 Phase 15: Mobile as Separate Website

### Goal
Dedicated mobile experience at `m.infinity.ai` or `/mobile` — not responsive downsizing, but purpose-built.

### Requirements
- [ ] **Separate Entry Point** — `artifacts/mobile/` (own Vite config, own build)
- [ ] **Touch-First** — swipe gestures, pull-to-refresh, bottom nav, sheet modals
- [ ] **Offline-First** — Service Worker, IndexedDB sync, background sync
- [ ] **PWA** — installable, splash screen, app shortcuts
- [ ] **Core Features Only** — Chat, Build status, Notifications, Quick actions
- [ ] **Shared API** — same backend, different frontend bundle
- [ ] **Deep Links** — `infinity://chat/123`, `infinity://build/456`

### Implementation Plan
1. **Mobile app scaffold** — Vite + React + PWA plugin
2. **Shared API client** — extract from main app, publish as internal package
3. **Mobile components** — bottom nav, sheets, gesture handlers
4. **Chat view** — optimized for narrow width, virtualized list
5. **Build monitoring** — real-time status, log streaming, push notifications
6. **Settings** — minimal, account + notifications only
7. **Deploy** — separate Netlify/Vercel site, shared API

### Files to Create/Modify
- `artifacts/mobile/` (new directory, own package.json)
- `artifacts/shared/api-client/` (extracted package)
- Deploy configs for mobile subdomain

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

## 🎯 Current Phase: **Phase 6 — Headless CI/CD Mode**

> **START HERE.** Next unchecked task: Create CLI binary structure in `artifacts/cli/`