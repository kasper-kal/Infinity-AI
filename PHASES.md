# Infinity AI — Master Implementation Phases

> **Read this file at the start of EVERY session.** This is the authoritative roadmap. Update it when phases complete or scope changes.

---

## 🎯 Mission
Make Infinity **THE BEST IT CAN BE for $0** — competitive with Claude Code, Replit Agent, Cursor, OpenHands, Cline, Aider, Goose — using only free tiers, local models, and open source.

---

## 📋 Phase Overview

| Phase | Title | Status |
|-------|-------|--------|
| **1** | **Build Project Map Subsystem** | ✅ **COMPLETE** |
| **2** | **Orchestration Engine (Claude Code Parity)** | ✅ **COMPLETE** |
| **3** | **Specialized Subagents with Schemas** | ✅ **COMPLETE** |
| **4** | **Virtual Worktrees + Parallel Agent Execution** | 🔲 PLANNED |
| **5** | **Local Terminal Bridge (node-pty WebSocket)** | 🔲 PLANNED |
| **6** | **MCP Client + Ecosystem Integration** | 🔲 PLANNED |
| **7** | **VS Code Extension (Infinity Build Panel)** | 🔲 PLANNED |
| **8** | **Replit-Level Design Canvas (Infinite Canvas + Ambient Intelligence)** | 🔲 PLANNED |
| **9** | **Parallel Agent Execution (Replit Agent 4 Style)** | 🔲 PLANNED |
| **10** | **Mobile App Development (React Native + Expo)** | 🔲 PLANNED |
| **11** | **Security Scanner + Secrets Manager (Replit-Level)** | 🔲 PLANNED |
| **12** | **Multi-Artifact Support (Slides, Website, Web App, Mobile)** | 🔲 PLANNED |
| **13** | **External Service Connectors (Linear, Slack, Notion, Sheets)** | 🔲 PLANNED |
| **14** | **Enterprise Features (SSO, VPC, Single-Tenant, Audit)** | 🔲 PLANNED |
| **15** | **Agent Skills & Custom Instructions Marketplace** | 🔲 PLANNED |
| **16** | **v0-Level Generative UI Engine (Chat → Code → Preview → Deploy)** | 🔲 PLANNED |
| **17** | **Visual Component Editor (Direct Manipulation + Code Sync)** | 🔲 PLANNED |
| **18** | **v0-Style Collaborative Workflows (Team, Comments, Reviews)** | 🔲 PLANNED |
| **19** | **External API & Database Integration (v0 Extensibility)** | 🔲 PLANNED |
| **20** | **Multi-Framework Support (Next.js, Astro, Remix, Vite, Svelte, Vue)** | 🔲 PLANNED |
| **21** | **AI-Powered Design Iteration (Variations, A/B, Analytics)** | 🔲 PLANNED |
| **22** | **Component Marketplace & Template Library (v0 Community)** | 🔲 PLANNED |
| **23** | **v0-Level Polish (Performance, Accessibility, DX)** | 🔲 PLANNED |
| **24** | **Cursor-Level Code Intelligence (Chat, Composer, Agent, Tab)** | 🔲 PLANNED |
| **25** | **Codebase Indexing & Semantic Search (Cursor @codebase)** | 🔲 PLANNED |
| **26** | **Rules, Notepads & Customization (Cursor Personalization)** | 🔲 PLANNED |
| **27** | **Shadow Workspaces & Agent Review (Cursor Autonomous QA)** | 🔲 PLANNED |
| **28** | **Design Mode & Visual Editing (Cursor Design Mode)** | 🔲 PLANNED |
| **29** | **IDE Integrations & CLI (Cursor Everywhere)** | 🔲 PLANNED |
| **30** | **Advanced Agent Capabilities (Cursor Agent Parity)** | 🔲 PLANNED |
| **31** | **Cursor-Level Performance & Polish (Speed, Reliability, DX)** | 🔲 PLANNED |

Roadmap groups: **Phases 2–7 = Claude Code parity**, **8–15 = Replit parity**, **16–23 = v0 parity**, **24–31 = Cursor parity**.

---

## 📦 Phase 1: Build Project Map Subsystem (CURRENT)

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

## 📦 Phase 2: Orchestration Engine (Claude Code Parity)

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
4. **Wire into Universal Agent** — orchestrate multi-tool chains with quality gates
5. **Add to tool registry** — `orchestration.pipeline`, `orchestration.parallel`, `orchestration.verify`, `orchestration.judge`

### Files to Create/Modify
- `artifacts/api-server/src/lib/orchestration-engine.ts` (new)
- `artifacts/api-server/src/lib/build-orchestrator.ts` (integrate adversarialVerify in verification loop)
- `artifacts/api-server/src/lib/universal-agent.ts` (integrate pipeline/parallel for multi-tool chains)
- `artifacts/api-server/src/lib/tool-registry.ts` (register orchestration tools)

---

## 📦 Phase 3: Specialized Subagents with Schemas

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

---

## 📦 Phase 4: Virtual Worktrees + Parallel Agent Execution

### Goal
**Isolated filesystem per agent** — enables true parallel execution without conflicts. Browser-native using IndexedDB + OPFS (Origin Private File System).

### Requirements
- [x] **Virtual Worktree Manager** — `artifacts/api-server/src/lib/virtual-worktree.ts`:
  - `createWorktree(baseCommit)` → isolated FS snapshot (IndexedDB + OPFS)
  - `applyPatch(worktreeId, diff)` → apply changes, return new state
  - `getDiff(worktreeId, baseCommit)` → unified diff
  - `mergeWorktrees(target, sources[])` — three-way merge, conflict detection
  - `listWorktrees()` / `deleteWorktree(id)`
- [x] **Parallel Agent Runner** — `artifacts/api-server/src/lib/parallel-agents.ts`:
  - Spawn N agents each with own worktree
  - Shared context via `BroadcastChannel` (read-only file map, decisions)
  - Results collected via `Promise.allSettled`
  - Auto-cleanup on completion/error
- [x] **Integration** — Build Mode: each coder agent gets own worktree; reviewer sees merged diff
- [x] **Fallback** — if OPFS unavailable, use IndexedDB-only virtual FS

### Implementation Plan
1. **Virtual FS Layer** — wrapper over `navigator.storage.getDirectory()` (OPFS) + IndexedDB fallback
2. **Git-like Operations** — diff/patch using `diff` npm package (already in deps), three-way merge
3. **Agent Isolation** — each agent gets `worktreeId` in `ToolExecutionContext`, all file ops scoped
4. **Build Orchestrator Integration** — parallel groups → each group gets fresh worktree from base
5. **Debug UI** — show worktree status, diffs, conflicts in Build Debug panel

### Files to Create/Modify
- `artifacts/api-server/src/lib/virtual-worktree.ts` (new)
- `artifacts/api-server/src/lib/parallel-agents.ts` (new)
- `artifacts/api-server/src/lib/build-orchestrator.ts` (integrate worktrees for parallel coders)
- `artifacts/jarvis/src/components/debug/` (worktree visualization panel)

---

## 📦 Phase 5: Local Terminal Bridge (node-pty WebSocket)

### Goal
**Real terminal in browser** — WebSocket bridge to `node-pty` running locally. User runs `npx infinity-terminal-bridge` once, gets full shell, git, npm, MCP servers.

### Requirements
- [x] **Bridge Server** — `artifacts/terminal-bridge/` (new package):
  - `node-pty` spawns `bash`/`zsh`/`fish` with inherited env
  - WebSocket server on `ws://localhost:3001` (configurable)
  - Auth: shared secret from `.infinity/bridge-secret` (generated on first run)
  - Handles multiple sessions (tabs) via session ID
  - Forwards stdin/stdout/stderr, resize, signals
- [x] **Frontend Terminal** — extend existing `xterm.js` in BuildView:
  - Connect to `ws://localhost:3001?session=<id>&secret=<secret>`
  - Reconnect on disconnect, buffer replay
  - Multiple terminals (tabs) per build
- [x] **MCP Server Bridge** — same WebSocket exposes MCP stdio transport:
  - Filesystem MCP → bridge → local filesystem
  - Git MCP → bridge → local git
  - SQLite MCP → bridge → local DB
  - Any stdio MCP server works
- [x] **Zero Config** — `npx infinity-terminal-bridge` auto-generates secret, prints connection URL
- [x] **Security** — secret rotation, IP allowlist (localhost only), command allowlist optional

### Implementation Plan
1. **Create `artifacts/terminal-bridge/`** — minimal Node.js + `ws` + `node-pty`
2. **Publish to npm** as `infinity-terminal-bridge` (free, public)
3. **Frontend** — `useTerminalBridge` hook in `BuildView`, auto-connect
4. **MCP Integration** — stdio-over-WebSocket adapter in tool registry
5. **Docs** — `TERMINAL_BRIDGE.md` with setup instructions

### Files to Create/Modify
- `artifacts/terminal-bridge/` (new directory — package.json, src/index.ts, bin/bridge.ts)
- `artifacts/jarvis/src/hooks/useTerminalBridge.ts` (new)
- `artifacts/jarvis/src/components/views/BuildView.tsx` (integrate bridge terminal)
- `artifacts/api-server/src/lib/tool-registry.ts` (MCP-over-bridge tools)

---

## 📦 Phase 6: MCP Client + Ecosystem Integration

### Goal
**Browser-native MCP client** — connect to any MCP server (local via terminal bridge, remote via HTTP/SSE). Infinity becomes an MCP *client*, not just a server.

### Requirements
- [x] **MCP Client** — `artifacts/api-server/src/lib/mcp-client.ts`:
  - Transports: stdio (via terminal bridge), HTTP+SSE, WebSocket
  - `connect(config)` → discovers tools/resources/prompts
  - `callTool(name, args)` → typed invocation with timeout/retry
  - `listTools()` / `listResources()` / `readResource(uri)`
  - Session management (reconnect, capability negotiation)
- [x] **Registry Integration** — MCP tools auto-registered in Universal Tool Registry with `mcp.` namespace
- [x] **Built-in Server Configs** — one-click connect to:
  - `filesystem` (via terminal bridge)
  - `github` (OAuth + PAT)
  - `postgres` / `sqlite` / `mysql`
  - `slack` / `discord` / `notion` / `linear` / `jira`
  - `brave-search` / `fetch` / `puppeteer`
- [x] **Project-Scoped Connections** — each project has its own MCP server configs (encrypted secrets)
- [x] **UI** — MCP Servers tab in Project Settings: add/remove/test/configure
- [x] **Database Persistence** — `mcp_servers` table with AES-256-GCM encryption for sensitive fields (API keys, tokens, connection strings)
- [ ] **Test MCP client with actual MCP servers** (filesystem, GitHub, PostgreSQL, etc.)
- [ ] **Verify Universal Tool Registry integration works end-to-end with agents**

### Implementation Plan
1. **MCP Client Library** — TypeScript implementation of MCP spec (modelcontextprotocol/sdk types) ✅
2. **Transport Adapters** — stdio-over-bridge, HTTP, SSE, WebSocket ✅
3. **Tool Registry Bridge** — `MCPToolAdapter` wraps MCP tool → Universal tool definition ✅
4. **Project Settings UI** — `MCPConfigPanel.tsx` in SettingsView ✅
5. **Secrets Management** — encrypt MCP credentials with project-scoped key ✅
6. **Database Persistence** — `mcp_servers` table with `loadConfigs()`/`persistConfigs()` ✅

### Files to Create/Modify
- `artifacts/api-server/src/lib/mcp-client.ts` (new) ✅
- `artifacts/api-server/src/lib/mcp-registry.ts` (new — auto-register discovered tools) ✅
- `artifacts/jarvis/src/components/views/SettingsView.tsx` (MCP servers tab) ✅
- `artifacts/api-server/src/routes/jarvis/mcp-servers.ts` (new — CRUD for project MCP configs) ✅

---

## 📦 Phase 7: VS Code Extension (Infinity Build Panel)

### Goal
**Free VS Code Extension** — "Infinity Build" on Marketplace. Sidebar panel with build control, inline diffs, diagnostics, "Send to Infinity" context menu.

### Requirements
- [ ] **Extension Host** — `artifacts/vscode-extension/`:
  - Activates on `infinity.build` command or sidebar click
  - Webview panel loads Infinity Build (localhost or deployed)
  - `vscode.workspace.fs` ↔ Infinity workspace sync (bidirectional)
- [ ] **Features**:
  - **Build Panel** — start/stop build, view plan, diffs, logs, terminal
  - **Inline Diffs** — inline edit provider for build-studio changes
  - **Diagnostics** — diagnostics tool → VS Code Problems panel
  - **Send to Infinity** — right-click file/folder → "Send to Infinity Build" (opens chat with context)
  - **File Sync** — changes in VS Code → Infinity workspace, vice versa
  - **Terminal Bridge** — "Open in Infinity Terminal" → connects to local bridge
- [ ] **Authentication** — VS Code secrets API for API key storage
- [ ] **Free Publish** — VS Code Marketplace (no cost)
- [ ] **Auto-Update** — GitHub Releases

### Implementation Plan
1. **Scaffold Extension** — TypeScript + Webview
2. **Webview Communication** — `postMessage` API for build control, file sync
3. **File System Provider** — optional: mount Infinity workspace as virtual FS
4. **Diagnostics Pipeline** — MCP `diagnostics` tool → VS Code markers
5. **Marketplace Publish** — `vsce package` → `vsce publish` (free)

### Files to Create/Modify
- `artifacts/vscode-extension/` (new — full extension)
- `artifacts/api-server/src/lib/mcp-tools/diagnostics.ts` (MCP tool for diagnostics)
- `artifacts/jarvis/src/components/views/BuildView.tsx` (extension messaging API)

---

## 📦 Phase 8: Replit-Level Design Canvas (Infinite Canvas + Ambient Intelligence)

### Goal
Build an **infinite design canvas** embedded in the app (not a separate tool) — like Replit Design Canvas. Visual design exploration with ambient intelligence that proactively suggests variations, Mobbin integration (600k+ real UI references), design system that snaps everything to it, templates by real designers droppable mid-flight.

### Requirements
- [ ] **Infinite Canvas Engine** — `artifacts/api-server/src/lib/design-canvas.ts` + frontend `DesignCanvas.tsx`:
  - Infinite zoom/pan canvas with layers (like Figma but code-connected)
  - Live preview of actual running app on canvas (iframe or embedded)
  - Direct manipulation: select, move, resize, edit styles visually
  - Multi-select, hover/active state editing, hover-to-preview interactions
  - Responsive overrides directly in UI → immediately applied to app
  - Artifact types: website pages, web app screens, mobile app screens, slides, docs
- [ ] **Ambient Intelligence** — proactive AI design suggestions:
  - Generates design variants automatically as you work
  - Shows suggested progressions you can accept with single click
  - Never blocks — suggestions appear alongside, not modal
  - Learns from your choices to improve future suggestions
- [ ] **Mobbin Integration** — 600k+ real UI/UX screens from 1000+ apps:
  - Search/reference library built into canvas sidebar
  - Drag patterns from Mobbin directly onto canvas
  - Competitive teardowns: pull competitor flow → generate comparable layout
  - No separate Mobbin account needed
- [ ] **Design System** — create once, everything snaps:
  - Colors, typography, spacing, components defined once
  - All canvas elements auto-snap to design system
  - Brand kit: "Your brand everywhere in one click"
  - Changes to design system propagate to all artifacts
- [ ] **Templates by Real Designers** — hundreds of pro templates:
  - Drop in at any moment mid-flight (not just starting point)
  - Remix multiple templates into something new
  - Categories: landing pages, dashboards, mobile apps, marketing, docs
- [ ] **Figma Import Pipeline** — Paste Figma link → design metadata → React + Tailwind:
  - Theme/color extraction, typography, component structure, auto-layout conversion
  - Basic interactions preserved
  - Known limitations: gradients, shadows, CSS variables, hidden layers, complex animations
  - After import: prompt for functional requirements + API integrations
- [ ] **Multi-Model Design Generation** — Claude, GPT-5, Gemini, Kimi, GLM selectable

### Implementation Plan
1. **Canvas Core** — Extend existing `Canvas.tsx` layout primitive with design-specific features
2. **Ambient Intelligence Service** — Background agent that watches canvas state, emits suggestions via SSE
3. **Mobbin API Integration** — Proxy to Mobbin (or local cached subset for $0)
4. **Design System Manager** — Token system + propagation to all canvas elements
5. **Figma Import** — Figma REST API → design tokens → React/Tailwind code gen
6. **Template Marketplace** — JSON template format, local-first, community contributions

### Files to Create/Modify
- `artifacts/api-server/src/lib/design-canvas.ts` (new)
- `artifacts/api-server/src/lib/ambient-intelligence.ts` (new)
- `artifacts/api-server/src/lib/mobbin-integration.ts` (new)
- `artifacts/api-server/src/lib/figma-import.ts` (new)
- `artifacts/jarvis/src/components/design/DesignCanvas.tsx` (new)
- `artifacts/jarvis/src/components/design/DesignSystemPanel.tsx` (new)
- `artifacts/jarvis/src/components/design/MobbinSidebar.tsx` (new)
- `artifacts/jarvis/src/components/design/TemplatePicker.tsx` (new)

---

## 📦 Phase 9: Parallel Agent Execution (Replit Agent 4 Style)

### Goal
**True parallel multi-agent execution** — like Replit Agent 4: split single task into concurrent forks (auth, database, UI, backend) each with own progress indicator and checkpoint system, merge seamlessly when done. Not sequential — parallel from the start.

### Requirements
- [ ] **Task Decomposition** — Planner agent breaks goal into independent parallel workstreams
- [ ] **Parallel Agent Pool** — Spawn N agents simultaneously, each with isolated context/worktree
- [ ] **Progress Tracking** — Per-agent progress indicators visible in UI (like Agent 4 panel)
- [ ] **Checkpoint System** — Each agent creates checkpoints, can rollback independently
- [ ] **Seamless Merge** — Three-way merge of parallel agent outputs, conflict detection/resolution
- [ ] **Agent Panel UI** — Sidebar showing all active agents, their tasks, progress, logs
- [ ] **Cross-Agent Communication** — Shared context store for decisions that affect multiple agents
- [ ] **Resource Management** — Concurrency limits, token budgets per agent, priority queue

### Implementation Plan
1. **Parallel Orchestrator** — Extend orchestration-engine with `parallelAgents()` primitive
2. **Agent Pool Manager** — Spawn/manage N UniversalAgent instances with isolated worktrees (Phase 4)
3. **Progress SSE Stream** — Real-time progress events from each agent to frontend
4. **Merge Engine** — Git-style three-way merge for code, design system merge for UI
5. **Agent Panel UI** — New component in BuildView sidebar showing parallel agent status

### Files to Create/Modify
- `artifacts/api-server/src/lib/parallel-orchestrator.ts` (new)
- `artifacts/api-server/src/lib/agent-pool.ts` (new)
- `artifacts/api-server/src/lib/merge-engine.ts` (new)
- `artifacts/jarvis/src/components/views/BuildView.tsx` (AgentPanel component)

---

## 📦 Phase 10: Mobile App Development (React Native + Expo)

### Goal
**Native iOS/Android app development from browser** — like Replit Mobile Apps: generate React Native + Expo apps from prompt, preview via QR code in Expo Go, submit to App Store/Play Store through guided flow. Full backend (database, auth, AI) included.

### Requirements
- [ ] **React Native Project Generator** — Scaffold Expo + React Native + TypeScript + NativeWind
- [ ] **Expo Go Preview** — QR code generation, live reload on device scan
- [ ] **Native Device Features** — Camera, location, push notifications, biometrics, haptics
- [ ] **Backend Integration** — Shared database/auth with web app (same project)
- [ ] **App Store Submission** — Guided flow: certificates, provisioning, TestFlight, App Store Connect
- [ ] **Play Store Submission** — Guided flow: signing, bundles, Play Console
- [ ] **Mobile-Specific Templates** — iOS/Android design patterns, navigation, gestures
- [ ] **Web ↔ Mobile Code Sharing** — Share components, logic, types between web and mobile

### Implementation Plan
1. **Expo Project Scaffold** — Template with TypeScript, NativeWind, file-based routing (Expo Router)
2. **Preview Bridge** — WebSocket tunnel for Expo Metro bundler → browser preview + QR code
3. **Native Module Bridge** — `expo-modules-core` for camera, location, notifications, etc.
4. **Unified Backend** — Same database/auth API for web + mobile
5. **Store Submission Automation** — `eas-cli` integration for build/submit pipelines
6. **Mobile Build View** — New tab in BuildView for mobile-specific controls

### Files to Create/Modify
- `artifacts/api-server/src/lib/mobile-app-generator.ts` (new)
- `artifacts/api-server/src/lib/expo-preview.ts` (new)
- `artifacts/api-server/src/lib/store-submission.ts` (new)
- `artifacts/jarvis/src/components/views/BuildView.tsx` (Mobile tab)
- `artifacts/jarvis/src/components/mobile/QRCodePreview.tsx` (new)
- `artifacts/jarvis/src/components/mobile/DeviceFeaturesPanel.tsx` (new)

---

## 📦 Phase 11: Security Scanner + Secrets Manager (Replit-Level)

### Goal
**Security while you build** — Replit-style: Semgrep-powered static analysis + LLM-based false positive filtering (93% accuracy per Replit research), encrypted secrets manager with secret detection, pre-deployment scanning, resource isolation.

### Requirements
- [ ] **Security Scanner Engine** — `artifacts/api-server/src/lib/security-scanner.ts`:
  - Semgrep integration (open source rules + custom rules)
  - Runs incrementally on every file change (watch mode)
  - LLM-based false positive filter: agent reviews findings, suppresses noise
  - Categories: secrets, SQLi, XSS, path traversal, auth bypass, crypto issues, dependencies
  - Results shown inline in editor + Build Debug panel
- [ ] **Secrets Manager** — `artifacts/api-server/src/lib/secrets-manager.ts`:
  - Encrypted storage (AES-256) for API keys, DB URLs, tokens
  - Secret detection in code (regex + ML) — blocks commits with secrets
  - Auto-rotation for supported providers (GitHub, Vercel, AWS, etc.)
  - Project-scoped + environment-scoped (dev/staging/prod)
  - Injection into build/runtime without exposing to LLM context
- [ ] **Pre-Deployment Scan** — Mandatory gate before deploy: security + secrets + dependency audit
- [ ] **Security Dashboard** — Project-wide view: findings by severity, trend, suppression log

### Implementation Plan
1. **Semgrep Wrapper** — Node.js child process or WASM build, rule packs for JS/TS/Python/Go
2. **LLM False Positive Filter** — Universal Agent with security-auditor skill
3. **Secrets Encryption** — Web Crypto API (browser) + Node crypto (server), per-project keys
4. **Git Hooks Integration** — Pre-commit secret scan via Husky (if git workspace)
5. **Security UI** — Panel in BuildView + Project Settings

### Files to Create/Modify
- `artifacts/api-server/src/lib/security-scanner.ts` (new)
- `artifacts/api-server/src/lib/secrets-manager.ts` (new)
- `artifacts/api-server/src/lib/secret-detection.ts` (new)
- `artifacts/jarvis/src/components/views/BuildView.tsx` (Security tab)
- `artifacts/jarvis/src/components/security/SecurityDashboard.tsx` (new)

---

## 📦 Phase 12: Multi-Artifact Support (Slides, Website, Web App, Mobile App)

### Goal
**Build different artifact types in parallel** — like Replit Agent 4: "Whether you want to create slides, a website, a web app, or even a mobile app, you simply describe what you need and the Agent does the work. You can even build different Artifacts in parallel."

### Requirements
- [ ] **Artifact Type Registry** — Extensible types: `slide-deck`, `website`, `web-app`, `mobile-app`, `api`, `cli-tool`, `chrome-extension`
- [ ] **Parallel Artifact Builds** — Single prompt → multiple artifact scaffolds running concurrently
- [ ] **Shared Foundation** — Common config, design system, components, backend across artifacts
- [ ] **Artifact-Specific Generators** — Each type has tailored scaffold + build pipeline
- [ ] **Cross-Artifact Sync** — Changes to shared foundation propagate to all artifacts
- [ ] **Unified Deploy** — Deploy all artifacts from single project (web + mobile + slides)

### Implementation Plan
1. **Artifact Type System** — Base class + registry, each type defines: scaffold, build, deploy, preview
2. **Parallel Build Orchestrator** — Extend Phase 9 for artifact-level parallelism
3. **Shared Foundation Layer** — Design system, components, API client, config shared via monorepo
4. **Artifact Generators** — Slide deck (Marp/Reveal), Website (Astro/Next), Web App (Vite/Next), Mobile (Expo)
5. **Unified Deploy Dashboard** — Single view for all artifact deployments

### Files to Create/Modify
- `artifacts/api-server/src/lib/artifact-types.ts` (new)
- `artifacts/api-server/src/lib/artifact-generators/` (new directory — one per type)
- `artifacts/api-server/src/lib/shared-foundation.ts` (new)
- `artifacts/jarvis/src/components/views/BuildView.tsx` (Artifact selector + parallel build UI)

---

## 📦 Phase 13: External Service Connectors (Linear, Slack, Notion, Google Sheets)

### Goal
**Connect external services and let agents work across them** — Replit Agent 4: "connect external services (e.g. Linear, Slack, Notion, Google Sheets) and ask the Agent to pull information from them, work across them, and build outputs based on that data."

### Requirements
- [ ] **Connector Framework** — Standard interface for OAuth + API key connectors
- [ ] **Built-in Connectors**:
  - Linear (issues, projects, cycles) → auto-create issues from build tasks
  - Slack (channels, messages, threads) → notifications, slash commands
  - Notion (pages, databases) → sync project docs, specs, research
  - Google Sheets (read/write) → data import/export, dashboards
  - GitHub (already have) — PRs, issues, actions
  - Figma (already have connector menu) — design import
- [ ] **Agent Tool Access** — Each connector exposes tools to Universal Agent (`linear.createIssue`, `slack.postMessage`, etc.)
- [ ] **Bi-directional Sync** — Changes in external service → Infinity, vice versa
- [ ] **Connector UI** — Project Settings → Connectors tab (extends existing ConnectorMenu)

### Implementation Plan
1. **Connector Base Class** — OAuth flow, token refresh, rate limiting, webhook handling
2. **Individual Connectors** — One file each in `connectors/` directory
3. **Tool Registration** — Auto-register connector tools in Universal Tool Registry
4. **Webhook Endpoints** — Generic `/webhooks/:connector/:event` route
5. **Settings UI** — Extend ConnectorMenu with OAuth flows, connection status, sync controls

### Files to Create/Modify
- `artifacts/api-server/src/lib/connectors/base.ts` (new)
- `artifacts/api-server/src/lib/connectors/linear.ts` (new)
- `artifacts/api-server/src/lib/connectors/notion.ts` (new)
- `artifacts/api-server/src/lib/connectors/google-sheets.ts` (new)
- `artifacts/api-server/src/routes/jarvis/connectors.ts` (extend)
- `artifacts/jarvis/src/components/layout/ConnectorMenu.tsx` (extend with OAuth)

---

## 📦 Phase 14: Enterprise Features (SSO, VPC, Single-Tenant, Audit Logs)

### Goal
**Enterprise-grade deployment** — SSO/SAML, VPC peering, single-tenant environments, audit logs, SCIM provisioning, static outbound IPs, region selection.

### Requirements
- [ ] **SSO/SAML/OIDC** — Integration with Okta, Microsoft Entra ID, Google Workspace, custom SAML
- [ ] **SCIM Provisioning** — Auto-provision/deprovision users from IdP
- [ ] **VPC Peering** — Dedicated GCP/AWS project, private network connectivity
- [ ] **Single-Tenant Option** — Isolated control plane + data plane per enterprise
- [ ] **Static Outbound IPs** — Predictable egress for firewall rules
- [ ] **Region Selection** — Deploy to specific GCP/AWS regions (data residency)
- [ ] **Audit Logs** — Organization-wide: app edits, deployments, permission changes, agent runs
- [ ] **Observability Export** — Send logs to Datadog, Splunk, Elastic, custom webhook
- [ ] **Role-Based Access Control** — Custom roles, resource-level permissions

### Implementation Plan
1. **Auth Provider Abstraction** — Pluggable IdP support (Clerk/Auth0/Keycloak/self-hosted)
2. **Multi-Tenancy Architecture** — Workspace isolation at database + network level
3. **VPC/Network Layer** — Terraform modules for dedicated VPC, peering, static IPs
4. **Audit Log Pipeline** — Structured events → ClickHouse/BigQuery → export APIs
5. **Enterprise Dashboard** — Admin panel for user management, audit review

### Files to Create/Modify
- `artifacts/api-server/src/lib/enterprise/auth-providers.ts` (new)
- `artifacts/api-server/src/lib/enterprise/vpc.ts` (new)
- `artifacts/api-server/src/lib/enterprise/audit-logs.ts` (new)
- `artifacts/api-server/src/lib/enterprise/sso.ts` (new)
- `artifacts/api-server/src/routes/jarvis/enterprise.ts` (new)
- `artifacts/jarvis/src/components/views/SettingsView.tsx` (Enterprise tab)

---

## 📦 Phase 15: Agent Skills & Custom Instructions Marketplace

### Goal
**Customize agents per project/team** — Reusable skill definitions but user-editable, project-scoped, with marketplace for sharing.

### Requirements
- [ ] **Skill Definition Format** — YAML/JSON with: instructions, tool preferences, verification rules, conventions, environment, role bindings, inheritance
- [ ] **Project-Scoped Skills** — Each project has its own skill overrides
- [ ] **Team/Org Skills** — Shared skills across projects in workspace
- [ ] **Skill Marketplace** — Local-first package management, $0 budget, install/publish/search
- [ ] **Custom Instructions** — Free-form text appended to agent system prompt per project
- [ ] **Skill Inheritance** — Base skill → project skill → task-specific skill
- [ ] **Skill Analytics** — Which skills used, success rates, token costs

### Implementation Plan
1. **Skill System Extension** — Add project/team scoping, marketplace, analytics
2. **Skill Editor UI** — Visual editor in Project Settings → Skills tab
3. **Marketplace Backend** — GitHub-based package index (free), local cache
4. **Agent Integration** — Universal Agent loads skills from project context automatically

### Files to Create/Modify
- `artifacts/api-server/src/lib/skills/` (extend existing skills system)
- `artifacts/api-server/src/routes/jarvis/skills.ts` (extend)
- `artifacts/jarvis/src/components/views/SettingsView.tsx` (Skills tab)
- `artifacts/jarvis/src/components/skills/SkillEditor.tsx` (new)
- `artifacts/jarvis/src/components/skills/SkillMarketplace.tsx` (new)

---

## 📦 Phase 16: v0-Level Generative UI Engine (Chat → Code → Preview → Deploy)

### Goal
Build **v0-equivalent generative UI engine** — chat interface that generates production-ready React/Next.js components with live preview, iterative refinement, and one-click deploy. Match v0's core loop: natural language → shadcn/ui + Tailwind components → live preview → deploy to free hosting.

### Requirements
- [ ] **Generative UI Chat Interface** — Dedicated "UI Builder" mode in ChatView:
  - Natural language → React component code (TypeScript, shadcn/ui, Tailwind)
  - Streaming code generation with real-time preview updates
  - Context-aware: uses project's existing design system, components, types
  - Iterative refinement: "make the button larger", "change to dark mode", "add loading state"
  - Multi-file generation: page + components + styles + types in one turn
- [ ] **Live Preview Engine** — `artifacts/jarvis/src/components/ui-builder/LivePreview.tsx`:
  - Sandbox iframe with React 18 + Tailwind + shadcn/ui preloaded
  - Hot module replacement (HMR) for instant updates
  - Console/error overlay in preview
  - Responsive viewport controls (mobile, tablet, desktop)
  - Code/Preview split view (resizable)
- [ ] **Component Library Integration** — Native shadcn/ui + Radix UI + Tailwind:
  - All shadcn/ui components available out of the box
  - Custom component registry (project-specific components)
  - Design token sync (colors, spacing, typography from project)
  - Component composition suggestions (autocomplete in chat)
- [ ] **Code Generation Pipeline** — `artifacts/api-server/src/lib/ui-codegen.ts`:
  - Prompt → AST → TypeScript/JSX → validated component
  - Type safety: generated code type-checks against project's tsconfig
  - Accessibility defaults (ARIA, semantic HTML)
  - Performance: memoization, lazy loading, code splitting hints
- [ ] **One-Click Deploy** — Deploy to free hosting (Vercel, Netlify, Cloudflare Pages, GitHub Pages):
  - Project linking (GitHub repo → auto-deploy on push)
  - Preview deployments for every chat iteration
  - Custom domain support (free tiers)
  - Environment variable management
- [ ] **UI Builder Mode Toggle** — In ChatView vertical ellipsis: "UI Builder Mode" (like Build Mode toggle)
  - Visual mode: full-screen preview + chat sidebar
  - Code mode: editor-focused with preview pane
  - Seamless switch between chat and UI builder

### Implementation Plan
1. **UI Codegen Engine** — `artifacts/api-server/src/lib/ui-codegen.ts`: prompt templates, component composition, type validation
2. **Live Preview Component** — sandbox iframe, HMR, error overlay
3. **UI Builder Chat Mode** — Extend ChatView with uiBuilderMode state, dedicated system prompt
4. **Component Registry** — Project-scoped shadcn/ui + custom components, design token sync
5. **Deploy Integration** — Vercel CLI / Netlify CLI / Cloudflare Pages API for free deployments
6. **UI Builder Panel** — New tab/view in BuildView or dedicated route

### Files to Create/Modify
- `artifacts/api-server/src/lib/ui-codegen.ts` (new)
- `artifacts/api-server/src/routes/jarvis/ui-builder.ts` (new — codegen + deploy endpoints)
- `artifacts/jarvis/src/components/ui-builder/LivePreview.tsx` (new)
- `artifacts/jarvis/src/components/ui-builder/ComponentRegistry.tsx` (new)
- `artifacts/jarvis/src/components/ui-builder/DeployPanel.tsx` (new)
- `artifacts/jarvis/src/components/views/ChatView.tsx` (add UI Builder mode)
- `artifacts/jarvis/src/components/views/BuildView.tsx` (UI Builder tab)

---

## 📦 Phase 17: Visual Component Editor (Direct Manipulation + Code Sync)

### Goal
**Direct manipulation of generated UI** — click any element in preview to edit props, styles, structure. Changes sync bidirectionally to code. Like v0's visual editing but fully code-connected.

### Requirements
- [ ] **Visual Element Inspector** — Hover/click in preview → highlight corresponding JSX in code editor
- [ ] **Prop Editor Panel** — Sidebar showing selected element's props (variant, size, className, children)
  - Visual controls: color picker, spacing slider, typography selector
  - shadcn/ui variant selectors (button variants, alert variants, etc.)
  - Tailwind class autocomplete with design token suggestions
- [ ] **Structure Manipulation** — Drag-drop to reorder, wrap/unwrap elements, delete, duplicate
  - Keyboard shortcuts for power users
  - Undo/redo stack synced with code history
- [ ] **Bidirectional Sync** — Code edits → preview updates instantly; visual edits → code updates instantly
  - AST-based code modification (preserve formatting, comments)
  - Conflict resolution when both change simultaneously
- [ ] **Design System Enforcement** — Visual edits constrained to design tokens
  - Can't pick arbitrary colors — only design system palette
  - Spacing/sizing snaps to token scale
  - Typography limited to defined scales
- [ ] **Component Extraction** — Select multiple elements → "Extract as Component" → creates new reusable component file

### Implementation Plan
1. **Preview-Code Bridge** — `postMessage` API between sandbox iframe and parent for selection sync
2. **AST Editor** — Use babel/recast for precise code modifications
3. **Prop Editor UI** — New component in UI Builder sidebar
4. **Design Token Integration** — Connect to project's design system (Phase 8)
5. **Extract Component Refactoring** — AST transform to create new component file + imports

### Files to Create/Modify
- `artifacts/api-server/src/lib/ast-editor.ts` (new)
- `artifacts/jarvis/src/components/ui-builder/PropEditor.tsx` (new)
- `artifacts/jarvis/src/components/ui-builder/VisualInspector.tsx` (new)
- `artifacts/jarvis/src/components/ui-builder/ComponentExtractor.tsx` (new)
- `artifacts/jarvis/src/components/ui-builder/LivePreview.tsx` (extend — selection bridge)

---

## 📦 Phase 18: v0-Style Collaborative Workflows (Team, Comments, Reviews)

### Goal
**Team collaboration on UI generation** — v0-style: share preview links, comment on specific elements, request changes, approve/merge. Built for product managers, designers, engineers working together.

### Requirements
- [ ] **Shareable Preview Links** — Public/private links to live preview with commenting enabled
  - No auth required for viewers (optional password)
  - Comments anchored to specific elements (via data attributes)
  - Real-time comment updates (SSE)
- [ ] **Element-Level Comments** — Click any element in preview → add comment → appears in chat + preview
  - Threaded replies, reactions, resolve/unresolve
  - @mentions notify team members
  - Comment history preserved across iterations
- [ ] **Review Workflow** — "Request Review" → reviewers see diff + preview → approve/request changes
  - Visual diff: before/after preview side-by-side
  - Code diff: generated changes highlighted
  - Approve merges to project; request changes creates task for generator
- [ ] **Role-Based Access** — Owner, Editor, Commenter, Viewer per project
- [ ] **Activity Feed** — Timeline of generations, edits, comments, deploys per project

### Implementation Plan
1. **Preview Sharing Service** — link generation, access control
2. **Comment Engine** — element anchoring, threading, real-time
3. **Review Workflow** — Extend project settings with review rules, notifications
4. **Frontend Comment UI** — Overlay in LivePreview, comment sidebar in ChatView
5. **Real-time Sync** — SSE for comments, presence cursors

### Files to Create/Modify
- `artifacts/api-server/src/lib/preview-sharing.ts` (new)
- `artifacts/api-server/src/lib/ui-comments.ts` (new)
- `artifacts/api-server/src/routes/jarvis/ui-collab.ts` (new)
- `artifacts/jarvis/src/components/ui-builder/CommentOverlay.tsx` (new)
- `artifacts/jarvis/src/components/ui-builder/CommentSidebar.tsx` (new)
- `artifacts/jarvis/src/components/ui-builder/ReviewPanel.tsx` (new)
- `artifacts/jarvis/src/components/views/SettingsView.tsx` (collaboration tab)

---

## 📦 Phase 19: External API & Database Integration (v0 Extensibility)

### Goal
**Connect external APIs and databases to generated UI** — v0: "integrate your APIs, databases, components." Generated components can fetch from REST/GraphQL, use Supabase/Firebase/PostgreSQL, call serverless functions.

### Requirements
- [ ] **API Integration Wizard** — In UI Builder: "Connect API" → paste OpenAPI/Swagger/GraphQL schema → generates typed hooks + components
  - REST: OpenAPI → TanStack Query hooks + TypeScript types
  - GraphQL: Introspection → TypedDocumentNode + urql/Apollo hooks
  - tRPC: Router inference → end-to-end types
- [ ] **Database Integration** — Connect Supabase, Firebase, Neon, PlanetScale, Turso, local SQLite
  - Schema introspection → typed database client (Kysely/Drizzle/Prisma)
  - Generated CRUD components (tables, forms, lists) with real-time subscriptions
  - RLS/policy awareness in generated code
- [ ] **Authentication Integration** — Clerk, Auth.js, Supabase Auth, Firebase Auth, custom JWT
  - Generated auth guards, login/register forms, protected routes
  - User profile components, session management
- [ ] **Serverless Function Generation** — API routes generated alongside UI
  - Next.js API routes / Edge Functions / Cloudflare Workers
  - Type-safe request/response validation (Zod)
  - Deployed with UI (same preview URL)
- [ ] **Environment Management** — Per-project env vars, secrets, preview/production environments
  - Injected into generated code at build time
  - UI for managing in Settings

### Implementation Plan
1. **API Schema Parser** — OpenAPI/GraphQL/tRPC → TypeScript types + hook generation
2. **Database Introspection** — Connect to DB → generate schema + typed client
3. **Auth Adapter Layer** — Unified interface for multiple auth providers
4. **Function Generator** — Component + API route pairs (form + submit handler)
5. **Env Manager** — Project settings → encrypt → inject at build/deploy

### Files to Create/Modify
- `artifacts/api-server/src/lib/api-integration.ts` (new)
- `artifacts/api-server/src/lib/db-integration.ts` (new)
- `artifacts/api-server/src/lib/auth-integration.ts` (new)
- `artifacts/api-server/src/lib/function-generator.ts` (new)
- `artifacts/jarvis/src/components/ui-builder/APIWizard.tsx` (new)
- `artifacts/jarvis/src/components/ui-builder/DatabasePanel.tsx` (new)
- `artifacts/jarvis/src/components/ui-builder/AuthPanel.tsx` (new)
- `artifacts/jarvis/src/components/views/SettingsView.tsx` (integrations tab)

---

## 📦 Phase 20: Multi-Framework Support (Next.js, Astro, Remix, Vite, Svelte, Vue)

### Goal
**Generate for any framework** — v0 focuses on Next.js; Infinity supports Next.js, Astro, Remix, Vite+React, SvelteKit, Vue/Nuxt, SolidStart. User chooses target framework per project or per generation.

### Requirements
- [ ] **Framework Adapters** — Each framework has:
  - Project scaffold generator (package.json, config, folder structure)
  - Component syntax (JSX/TSX, .svelte, .vue)
  - Routing conventions (file-based, config-based)
  - Styling integration (Tailwind, UnoCSS, CSS Modules, styled-components)
  - Deployment config (Vercel, Netlify, Cloudflare, Docker)
- [ ] **Framework Detection** — Auto-detect from existing project or prompt user
- [ ] **Cross-Framework Component Library** — Core components implemented per framework
  - shadcn/ui equivalents for Svelte (shadcn-svelte), Vue (shadcn-vue), Solid
  - Design tokens shared across frameworks (Style Dictionary / Tokens Studio)
- [ ] **Migration Assistant** — "Convert this Next.js project to Astro" → automated migration
- [ ] **Monorepo Support** — Generate multiple frameworks in one workspace (web + mobile + docs)

### Implementation Plan
1. **Framework Registry** — interface + implementations
2. **Scaffold Generators** — Per-framework templates with design system pre-configured
3. **Component Transpiler** — Universal component IR → framework-specific output
4. **Design Token Pipeline** — Single source → CSS vars, Tailwind config, UnoCSS, native tokens
5. **Migration Tools** — AST transforms for framework-to-framework conversion

### Files to Create/Modify
- `artifacts/api-server/src/lib/framework-adapters.ts` (new)
- `artifacts/api-server/src/lib/framework-generators/` (new dir — one per framework)
- `artifacts/api-server/src/lib/component-ir.ts` (new — intermediate representation)
- `artifacts/api-server/src/lib/design-token-pipeline.ts` (new)
- `artifacts/jarvis/src/components/ui-builder/FrameworkSelector.tsx` (new)

---

## 📦 Phase 21: AI-Powered Design Iteration (Variations, A/B, Analytics)

### Goal
**v0-style "magic" iterations** — Generate design variations automatically, A/B test in preview, analytics on user interactions. Ambient intelligence that improves designs while you work.

### Requirements
- [ ] **Auto-Variation Generation** — Background agent generates 3-5 variations of current design:
  - Different layouts, color schemes, typography, spacing
  - Accessibility improvements (contrast, focus states)
  - Performance optimizations (fewer renders, smaller bundle)
  - Shown in "Variations" sidebar — one click to apply
- [ ] **A/B Preview Mode** — Split preview: original vs variation side-by-side
  - Interactive both panes
  - Metrics: click heatmaps, scroll depth, time on element
  - "Winner" selection merges changes
- [ ] **Design Analytics** — If deployed via Infinity, collect (privacy-respecting):
  - Interaction events (clicks, hovers, form submissions)
  - Performance metrics (LCP, CLS, FID via Web Vitals)
  - Funnel analysis for multi-step flows
  - Dashboard in BuildView
- [ ] **Smart Suggestions** — Based on analytics + best practices:
  - "Users drop off at step 3 — simplify form"
  - "Button contrast fails WCAG AA — here's a fix"
  - "Mobile layout breaks at 375px — here's responsive fix"

### Implementation Plan
1. **Variation Generator Agent** — Background Universal Agent with design critic prompt
2. **A/B Preview Component** — Dual iframe with synchronized interactions
3. **Analytics Collector** — Lightweight script injected in preview/deployed apps
4. **Analytics Dashboard** — BuildView tab with charts, funnels, recommendations
5. **Suggestion Engine** — Rules + LLM analysis of analytics → actionable fixes

### Files to Create/Modify
- `artifacts/api-server/src/lib/design-variations.ts` (new)
- `artifacts/api-server/src/lib/design-analytics.ts` (new)
- `artifacts/api-server/src/lib/suggestion-engine.ts` (new)
- `artifacts/jarvis/src/components/ui-builder/VariationsPanel.tsx` (new)
- `artifacts/jarvis/src/components/ui-builder/ABPreview.tsx` (new)
- `artifacts/jarvis/src/components/ui-builder/AnalyticsDashboard.tsx` (new)
- `artifacts/jarvis/src/components/views/BuildView.tsx` (analytics tab)

---

## 📦 Phase 22: Component Marketplace & Template Library (v0 Community)

### Goal
**Shareable, installable components and templates** — v0 has community templates; Infinity adds: local-first package management, versioning, dependency resolution, private team registries.

### Requirements
- [ ] **Component Package Format** — `.infinity-component` spec:
  - Component code (framework-agnostic IR + framework-specific outputs)
  - Design token dependencies
  - Peer dependencies (React version, Tailwind version)
  - Documentation, props schema, usage examples
  - Test files (Vitest + Playwright)
- [ ] **Local-First Registry** — GitHub-based index (free), local cache
  - `infinity add @user/component-name` → installs to project
  - Version ranges, lockfile, dependency resolution
  - Private scopes: `@team/`, `@org/`
- [ ] **Template Library** — Full project starters:
  - SaaS dashboard, landing page, blog, docs site, mobile app, chrome extension
  - Each template: scaffold + design system + example pages + deploy config
  - Community submissions via PR to infinity-templates repo
- [ ] **Template Customization** — "Use this template" → wizard for:
  - Project name, branding, color scheme, features
  - Generates customized project (not just clone)
- [ ] **Marketplace UI** — Browse, search, preview, install from Settings or UI Builder
  - Ratings, downloads, compatibility badges
  - "Install to project" button

### Implementation Plan
1. **Package Spec** — Define `.infinity-component` format, manifest schema
2. **Registry Client** — GitHub API for index, local filesystem cache
3. **Installer** — Dependency resolution, code generation, config merging
4. **Template Engine** — Variable substitution, conditional files, post-install scripts
5. **Marketplace UI** — Searchable grid with live previews (iframe sandbox)

### Files to Create/Modify
- `artifacts/api-server/src/lib/component-registry.ts` (new)
- `artifacts/api-server/src/lib/template-engine.ts` (new)
- `artifacts/api-server/src/routes/jarvis/marketplace.ts` (new)
- `artifacts/jarvis/src/components/ui-builder/ComponentMarketplace.tsx` (new)
- `artifacts/jarvis/src/components/ui-builder/TemplateLibrary.tsx` (new)
- `artifacts/jarvis/src/components/views/SettingsView.tsx` (marketplace tab)

---

## 📦 Phase 23: v0-Level Polish (Performance, Accessibility, DX)

### Goal
**Match v0's polish** — Sub-second preview updates, zero-config accessibility, delightful DX. The "it just works" factor.

### Requirements
- [ ] **Preview Performance** — <500ms cold start, <100ms HMR:
  - Pre-warmed sandbox pool (reuse iframes)
  - Incremental compilation (esbuild SWC in browser via WebAssembly)
  - Dependency caching (shadcn/ui, Radix pre-bundled)
  - Streaming preview updates (progressive enhancement)
- [ ] **Accessibility by Default** — Every generated component passes WCAG AA:
  - Semantic HTML, ARIA attributes, focus management
  - Color contrast validation in real-time
  - Keyboard navigation, screen reader testing
  - axe-core integration in preview + CI
- [ ] **Error Experience** — Friendly, actionable errors:
  - Preview overlay: "Here's what went wrong, here's how to fix"
  - Code annotations: red squiggles at exact error location
  - Auto-fix suggestions (one-click apply)
  - Link to docs/examples for common errors
- [ ] **Keyboard-First DX** — All UI Builder actions keyboard accessible:
  - Command palette (Cmd+K) for all actions
  - Vim/Emacs keybindings in code editor
  - Shortcuts for: toggle preview, extract component, deploy, variation
- [ ] **Offline-First** — Service Worker caches:
  - Sandbox runtime, component library, design tokens
  - Works offline for editing; syncs on reconnect
  - IndexedDB for project state persistence

### Implementation Plan
1. **Sandbox Pool Manager** — Pre-warm N iframes, recycle on navigation
2. **WASM Bundler** — esbuild/SWC compiled to WASM for browser bundling
3. **A11y Linter** — Real-time axe-core in preview, CI integration
4. **Error Formatter** — Structured error objects → friendly UI + auto-fix
5. **Command Palette** — Centralized action registry with fuzzy search
6. **Service Worker** — Workbox for caching strategy

### Files to Create/Modify
- `artifacts/api-server/src/lib/sandbox-pool.ts` (new)
- `artifacts/api-server/src/lib/wasm-bundler.ts` (new)
- `artifacts/jarvis/src/components/ui-builder/ErrorOverlay.tsx` (new)
- `artifacts/jarvis/src/components/ui-builder/CommandPalette.tsx` (new)
- `artifacts/jarvis/public/sw.js` (new — service worker)
- `artifacts/jarvis/src/hooks/useOffline.ts` (new)

---

## 📦 Phase 24: Cursor-Level Code Intelligence (Chat, Composer, Agent, Tab)

### Goal
Build **Cursor-equivalent code intelligence** — AI-native IDE features: Chat with codebase context, Composer for multi-file editing, Agent for autonomous coding, Tab autocomplete with semantic understanding. All in-browser, $0 cost.

### Requirements
- [ ] **Cursor Chat** — persistent sidebar chat with full codebase context (@codebase):
  - @ symbols: @file, @folder, @codebase, @docs, @git, @web, @terminal
  - Inline code references with click-to-open
  - Streaming responses with tool calls visible
  - History per conversation, searchable
  - Model selector (Claude, GPT-4, Gemini, local models)
- [ ] **Composer (Multi-File Editor)**:
  - Natural language → multi-file diff generation
  - Preview all changes before apply (side-by-side diff)
  - Apply selectively or all at once
  - Iterative refinement: "also update the tests", "fix the types"
  - Context-aware: reads related files automatically
  - Supports new file creation + edits + deletions
- [ ] **Agent Mode**:
  - Autonomous: explore → plan → implement → test → verify
  - Tool use: read, write, edit, grep, glob, terminal, browser, git
  - Checkpointing: save/restore agent state
  - Parallel sub-agents for independent tasks
  - Human-in-the-loop: pause, steer, approve at any point
- [ ] **Tab Autocomplete**:
  - Multi-line, context-aware completions (not just single-line)
  - Understands codebase patterns, imports, types
  - Tab to accept, Esc to dismiss
  - Works in any editor (CodeMirror, Monaco, textarea)
  - Local model option (Qwen2.5-Coder, DeepSeek-Coder) for privacy/speed
- [ ] **Cmd+K Inline Edit** — Quick targeted edits at cursor position
  - Select code → Cmd+K → describe change → diff preview → accept

### Implementation Plan
1. **Codebase Indexer** — semantic embeddings, incremental updates, @codebase retrieval
2. **Composer Engine** — Multi-file diff generation with dependency tracking, preview/apply UI
3. **Agent Runtime** — Extend Universal Agent with codebase tools, planning, verification loop
4. **Tab Autocomplete** — Local LLM (WASM) or API streaming, prefix/suffix context
5. **Chat Sidebar** — Reuse Universal Agent + codebase context, @ symbol parser, streaming UI

### Files to Create/Modify
- `artifacts/api-server/src/lib/codebase-indexer.ts` (new)
- `artifacts/api-server/src/lib/cursor-agent.ts` (new)
- `artifacts/api-server/src/lib/cursor-composer.ts` (new)
- `artifacts/api-server/src/routes/jarvis/cursor.ts` (new — chat, composer, agent endpoints)
- `artifacts/jarvis/src/components/cursor/ChatSidebar.tsx` (new)
- `artifacts/jarvis/src/components/cursor/Composer.tsx` (new)
- `artifacts/jarvis/src/components/cursor/TabAutocomplete.tsx` (new)
- `artifacts/jarvis/src/components/cursor/CmdKEdit.tsx` (new)
- `artifacts/jarvis/src/components/views/ChatView.tsx` (integrate Cursor Chat mode)
- `artifacts/jarvis/src/components/views/BuildView.tsx` (Composer/Agent tabs)

---

## 📦 Phase 25: Codebase Indexing & Semantic Search (Cursor @codebase)

### Goal
**Semantic codebase understanding** — like Cursor's @codebase: secure, fast, incremental indexing enabling "how does auth work?", "where is the payment logic?", "find all API routes" with precise file+line references.

### Requirements
- [ ] **Indexing Engine** — `artifacts/api-server/src/lib/codebase-indexer.ts`:
  - Language-aware parsing (TS/JS, Python, Go, Rust, etc.) via tree-sitter
  - Chunking: functions, classes, types, imports, exports, comments
  - Embeddings: local (WASM) + remote fallback
  - Vector storage: SQLite-vec (local) or pgvector — no external vector DB needed
  - Incremental updates: watch file changes → re-index affected chunks only
  - Project-scoped: each project has isolated index
  - Privacy: local-first, remote only with explicit opt-in
- [ ] **Semantic Search** — Natural language → relevant code chunks:
  - Query expansion: "auth" → "authentication, login, session, JWT, OAuth"
  - Hybrid search: vector + keyword (BM25) + symbol matching
  - Reranking: cross-encoder for top-k results
  - Citations: every result links to file:line with context
- [ ] **@codebase Integration** — In Chat/Composer/Agent:
  - Auto-trigger on @codebase mention
  - Inject top-N relevant chunks into context
  - Show sources used in response
- [ ] **Code Navigation** — "Go to definition", "Find references", "Call hierarchy" via index
- [ ] **Index Management UI** — BuildView tab: index status, re-index, exclude patterns, size stats

### Implementation Plan
1. **Tree-sitter Parser** — WASM grammars for major languages, extract symbols + chunks
2. **Embedding Pipeline** — Batch embed chunks, store locally
3. **Search API** — Hybrid vector+keyword search with reranking
4. **Incremental Watcher** — chokidar + debounced re-index
5. **Frontend Integration** — @codebase parser in chat/composer, results display

### Files to Create/Modify
- `artifacts/api-server/src/lib/codebase-indexer.ts` (new)
- `artifacts/api-server/src/lib/tree-sitter-parsers.ts` (new)
- `artifacts/api-server/src/lib/embeddings.ts` (new)
- `artifacts/api-server/src/routes/jarvis/codebase-index.ts` (new)
- `artifacts/jarvis/src/components/cursor/CodebaseIndexPanel.tsx` (new)
- `artifacts/jarvis/src/components/cursor/ChatSidebar.tsx` (extend — @codebase)

---

## 📦 Phase 26: Rules, Notepads & Customization (Cursor Personalization)

### Goal
**Personalize AI behavior per project/team/user** — Rules (project/user), Notepads (reusable context), Model Preferences, Custom Instructions — all version-controlled and shareable.

### Requirements
- [ ] **Rules** — `.infinity/rules/` support:
  - Project rules at repo root (auto-loaded)
  - User rules: global preferences (coding style, frameworks, conventions)
  - Rule types: always, auto-attached (glob patterns), agent-requested
  - Rule editor UI: syntax-highlighted, validation, templates
  - Inheritance: user → project → task-specific
- [ ] **Notepads** — Reusable context snippets:
  - Save any chat context, code selection, or docs as notepad
  - `@notepad:name` to inject in chat/composer/agent
  - Team-shared notepads (project-scoped)
  - Version control: notepads as `.infinity/notepads/*.md` files
  - Categories: architecture decisions, API contracts, common patterns, debugging guides
- [ ] **Model Preferences** — Per-project/user model routing:
  - Default model for chat, composer, agent, tab
  - Fallback chain: primary → secondary → local
  - Cost/latency/quality preferences
  - BYOM (Bring Your Own Model) — custom OpenAI-compatible endpoints
- [ ] **Custom Instructions** — Free-form prompt additions:
  - Per-agent overrides (composer vs agent vs chat)
  - UI: Settings → AI Customization

### Implementation Plan
1. **Rules Parser** — Load rules files, parse frontmatter + glob patterns
2. **Notepad Manager** — CRUD for notepads, file-based storage, @notepad resolver
3. **Model Router** — Extend LLM adapter with per-capability model selection
4. **Settings UI** — Rules editor, Notepad manager, Model preferences panel

### Files to Create/Modify
- `artifacts/api-server/src/lib/rules.ts` (new)
- `artifacts/api-server/src/lib/notepads.ts` (new)
- `artifacts/api-server/src/lib/model-router.ts` (new)
- `artifacts/api-server/src/routes/jarvis/customization.ts` (new)
- `artifacts/jarvis/src/components/cursor/RulesEditor.tsx` (new)
- `artifacts/jarvis/src/components/cursor/NotepadManager.tsx` (new)
- `artifacts/jarvis/src/components/cursor/ModelPreferences.tsx` (new)
- `artifacts/jarvis/src/components/views/SettingsView.tsx` (AI Customization tab)

---

## 📦 Phase 27: Shadow Workspaces & Agent Review (Cursor Autonomous QA)

### Goal
**Automated quality assurance** — Shadow Workspaces (isolated env for agents) + Agent Review (automated PR reviews with code understanding). Run agents in parallel, review changes before merge.

### Requirements
- [ ] **Shadow Workspaces** — `artifacts/api-server/src/lib/shadow-workspace.ts`:
  - Ephemeral, isolated workspace per agent task (virtual FS via Phase 4)
  - Pre-seeded with project state (git clone, deps installed, services running)
  - Agent runs: explore → modify → test → report
  - Auto-cleanup on completion, preserve artifacts on failure
  - Resource limits: CPU, memory, time, network
  - Pool of warm workspaces for instant start
- [ ] **Agent Review** — `artifacts/api-server/src/lib/agent-review.ts`:
  - Trigger: on PR creation, on push, manual, scheduled
  - Review dimensions: correctness, security, performance, style, tests, breaking changes
  - Context: full PR diff + related codebase files (via indexer)
  - Output: inline comments on PR, summary, approve/request-changes
  - Configurable rules per repo (severity, ignore patterns)
  - Learning: track false positives, improve over time
- [ ] **Multi-Agent Collaboration** — Parallel agents on single task:
  - Planner decomposes → spawn N agents → merge results
  - Shared context store
  - Progress visible in UI
- [ ] **Cloud Agents (Long-Running)** — Agents that run hours/days:
  - Persistent task state
  - Scheduled triggers (cron, webhook, PR events)
  - Notifications on completion
  - Cost tracking + budgets

### Implementation Plan
1. **Shadow Workspace Manager** — Extend Virtual Worktree (Phase 4) with service orchestration
2. **Agent Review Engine** — Universal Agent with review prompt, PR API integration
3. **Multi-Agent Orchestrator** — Extend orchestration engine with parallel groups
4. **Cloud Agent Runtime** — Persistent tasks + scheduler + notification webhooks

### Files to Create/Modify
- `artifacts/api-server/src/lib/shadow-workspace.ts` (new)
- `artifacts/api-server/src/lib/agent-review.ts` (new)
- `artifacts/api-server/src/lib/multi-agent-orchestrator.ts` (new)
- `artifacts/api-server/src/routes/jarvis/agent-review.ts` (new)
- `artifacts/jarvis/src/components/cursor/ShadowWorkspacePanel.tsx` (new)
- `artifacts/jarvis/src/components/cursor/AgentReviewPanel.tsx` (new)
- `artifacts/jarvis/src/components/views/BuildView.tsx` (Agent Review tab)

---

## 📦 Phase 28: Design Mode & Visual Editing (Cursor Design Mode)

### Goal
**Visual development in the IDE** — click UI in preview → jump to code, edit visually, see changes instantly. Bridge between design and code like Figma but code-native.

### Requirements
- [ ] **Design Mode Toggle** — In BuildView/Preview: enter visual editing mode
- [ ] **Element Inspector** — Hover/click in preview → highlight in editor + show props panel
  - Bidirectional: select in editor → highlight in preview
  - Works for React, Vue, Svelte, HTML components
- [ ] **Visual Property Editor** — Sidebar for selected element:
  - Style props: color, spacing, typography, layout (visual controls)
  - Component props: variant, size, disabled, etc.
  - Tailwind class editor with autocomplete + design token suggestions
  - Live preview as you edit
- [ ] **Component Playground** — Isolated component rendering:
  - Render any component with editable props
  - State simulation (hover, focus, loading, error)
  - Responsive preview (mobile/tablet/desktop)
  - Export as story or test
- [ ] **Design System Sync** — Connect to project's design tokens (Phase 8):
  - Colors, spacing, typography from design system → visual controls
  - Changes to tokens → propagate to all components
  - "Extract design tokens from CSS" for existing projects

### Implementation Plan
1. **Preview-Editor Bridge** — Extend visual inspector with design-mode features
2. **Property Editor** — Visual controls for CSS/props, design token integration
3. **Component Registry** — Parse project components → prop types → visual editors
4. **Design Token Bridge** — Sync with Design System Manager (Phase 8)

### Files to Create/Modify
- `artifacts/api-server/src/lib/design-mode.ts` (new)
- `artifacts/jarvis/src/components/design/DesignMode.tsx` (new)
- `artifacts/jarvis/src/components/design/VisualPropertyEditor.tsx` (new)
- `artifacts/jarvis/src/components/design/ComponentPlayground.tsx` (new)
- `artifacts/jarvis/src/components/ui-builder/LivePreview.tsx` (extend — design mode)

---

## 📦 Phase 29: IDE Integrations & CLI (Cursor Everywhere)

### Goal
**Use Infinity Build from any IDE** — VS Code extension (Phase 7), JetBrains plugin, Neovim plugin, CLI, Shell integration.

### Requirements
- [ ] **VS Code Extension** — (Phase 7) Full feature parity:
  - Chat sidebar, Composer panel, Agent view, Tab autocomplete
  - Inline diffs, diagnostics, @codebase, rules, notepads
  - File sync, terminal bridge, MCP servers
- [ ] **JetBrains Plugin** — IntelliJ, WebStorm, PyCharm, GoLand, Rider:
  - Same features via JetBrains platform APIs
  - Kotlin implementation, Gradle build
  - Marketplace publish (free)
- [ ] **Neovim Plugin** — Lua plugin for Neovim 0.9+:
  - Chat buffer, Composer buffer, Agent buffer
  - Tab autocomplete via nvim-cmp source
  - @codebase via RPC to Infinity API
- [ ] **CLI (`infinity`)**:
  - `infinity chat "question"` — CLI chat with codebase context
  - `infinity compose "task"` — Multi-file generation from terminal
  - `infinity agent "goal"` — Autonomous agent run
  - `infinity review` — Agent review on current diff
  - `infinity index` — Trigger codebase re-index
  - Shell completion (bash, zsh, fish)
- [ ] **Shell Integration**:
  - `infinity <file>` — Open in Infinity web UI
  - Pipe support: `git diff | infinity review`

### Implementation Plan
1. **VS Code Extension** — Complete Phase 7 with full feature set
2. **JetBrains Plugin** — Scaffold with Gradle, implement core features
3. **Neovim Plugin** — Lua + RPC client, nvim-cmp source
4. **CLI Enhancement** — chat/compose/agent/review/index commands
5. **Shell Integration** — Wrapper scripts, completion generators

### Files to Create/Modify
- `artifacts/vscode-extension/` (extend Phase 7)
- `artifacts/jetbrains-plugin/` (new — Kotlin + Gradle)
- `artifacts/neovim-plugin/` (new — Lua)
- `artifacts/api-server/src/bin/infinity-cli.ts` (new)
- `artifacts/shell-integration/` (new — bash/zsh/fish completions)

---

## 📦 Phase 30: Advanced Agent Capabilities (Cursor Agent Parity)

### Goal
**Match Cursor Agent's advanced capabilities** — Planning mode, debugging, git integration, MCP servers, subagents, hooks, automations.

### Requirements
- [ ] **Planning Mode** — Agent creates plan before executing:
  - User describes goal → agent explores codebase → presents plan (steps, files, risks)
  - User approves/modifies → agent executes with progress updates
  - Plan persists, can resume later
- [ ] **Debugging Agent** — Agent can run/debug code:
  - Set breakpoints, inspect variables, step through
  - Run tests, capture output, analyze failures
  - Auto-fix test failures
- [ ] **Git Integration** — Agent understands git:
  - git log/diff/blame as tools
  - "What changed in this PR?" → summary with impact analysis
  - Auto-generate commit messages, PR descriptions
  - Conflict resolution assistance
- [ ] **MCP Server Integration** — (Phase 6) Agent uses MCP tools:
  - Filesystem, GitHub, PostgreSQL, Slack, Linear, etc.
  - Auto-discover project MCP config
  - Tool calls visible in agent timeline
- [ ] **Subagents** — Specialized agents for specific tasks:
  - Code reviewer, debugger, test writer, documenter, researcher
  - Spawned by main agent, isolated context, report back
  - Defined in `.infinity/subagents/*.json`
- [ ] **Hooks & Automations** — Event-driven agent triggers:
  - On file save, on git push, on PR open, on schedule, on webhook
  - Custom scripts: `infinity hook on-save "run tests"`

### Implementation Plan
1. **Planning Agent** — Extend Universal Agent with planning phase + plan persistence
2. **Debugging Tools** — Add debug adapter protocol (DAP) tools
3. **Git Tools** — Wrap git CLI as universal tools
4. **MCP Integration** — Complete Phase 6, expose to agent
5. **Subagent System** — Define spec, registry, spawning from agent (extends Phase 3)
6. **Hooks Engine** — Event bus + script runner + scheduler

### Files to Create/Modify
- `artifacts/api-server/src/lib/planning-agent.ts` (new)
- `artifacts/api-server/src/lib/debug-tools.ts` (new)
- `artifacts/api-server/src/lib/git-tools.ts` (new)
- `artifacts/api-server/src/lib/subagents.ts` (extend Phase 3)
- `artifacts/api-server/src/lib/hooks-engine.ts` (new)
- `artifacts/api-server/src/routes/jarvis/advanced-agent.ts` (new)
- `artifacts/jarvis/src/components/cursor/PlanningPanel.tsx` (new)
- `artifacts/jarvis/src/components/cursor/DebugPanel.tsx` (new)
- `artifacts/jarvis/src/components/views/BuildView.tsx` (Advanced Agent tab)

---

## 📦 Phase 31: Cursor-Level Performance & Polish (Speed, Reliability, DX)

### Goal
**Match Cursor's speed and polish** — Sub-100ms Tab, instant Chat, reliable Agent, zero-config setup. The "it just works" factor that makes developers switch.

### Requirements
- [ ] **Tab Autocomplete Speed** — <100ms latency (p50):
  - Local model (WASM) for instant fallback
  - Speculative fetching: pre-fetch next suggestions
  - Caching: recent contexts → instant completions
  - Debounced requests, cancel on new keystroke
- [ ] **Chat/Composer Latency** — <500ms first token:
  - Streaming from first token
  - Context pre-fetching (anticipate @codebase needs)
  - Connection pooling, keep-alive
- [ ] **Agent Reliability** — 99%+ task completion:
  - Circuit breakers, retries, fallbacks
  - Clear error messages with recovery actions
  - Checkpoint/resume on any failure
  - Progress visibility: always know what agent is doing
- [ ] **Zero-Config Setup** — Open project → works instantly:
  - Auto-detect framework, language, package manager
  - Auto-index codebase on first open
  - Sensible defaults for rules, models, exclusions
  - One-click "Connect to Infinity" from any IDE
- [ ] **Offline-First** — Core features work without internet:
  - Local Tab model (small coder models via WASM)
  - Local codebase index (SQLite-vec)
  - Local chat with local LLM (Ollama/LM Studio)
  - Sync when online
- [ ] **Accessibility** — WCAG AA, keyboard-first, screen readers:
  - All AI features keyboard navigable
  - High contrast mode, reduced motion
  - Announce AI actions (completions, diffs, agent steps)

### Implementation Plan
1. **Performance Profiling** — Benchmark each feature, optimize hot paths
2. **Local Model Pipeline** — WASM compilation of small coder models, embeddings
3. **Caching Layer** — Multi-level: memory, IndexedDB, SQLite
4. **Offline Architecture** — Service Worker + IndexedDB + background sync
5. **A11y Audit** — axe-core CI, manual testing, fix all violations

### Files to Create/Modify
- `artifacts/api-server/src/lib/performance.ts` (new — benchmarks, profiling)
- `artifacts/jarvis/src/components/cursor/TabAutocomplete.tsx` (optimize — WASM model)
- `artifacts/jarvis/src/components/cursor/ChatSidebar.tsx` (optimize — streaming, pre-fetch)
- `artifacts/jarvis/public/sw.js` (extend — offline support)
- `artifacts/jarvis/src/hooks/useOffline.ts` (new)
- `artifacts/jarvis/src/components/cursor/Accessibility.tsx` (new — a11y helpers)

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

## 🎯 Current Phase: **Phase 6 — MCP Client + Ecosystem Integration** ✅ **DATABASE PERSISTENCE COMPLETE** — Remaining: Test with actual MCP servers, verify Universal Tool Registry integration with agents

## 🎯 Upcoming Phases
1. **Phase 2** — Orchestration Engine (COMPLETE ✅)
2. **Phase 3** — Specialized Subagents (COMPLETE ✅)
3. **Phase 4** — Virtual Worktrees + Parallel Agents (COMPLETE ✅)
4. **Phase 5** — Local Terminal Bridge (COMPLETE ✅)
5. **Phase 6** — MCP Client + Ecosystem (Database Persistence ✅)
6. **Phase 7** — VS Code Extension
