# Build Mode Completion Plan — "Actually Finished"

**Goal:** Build Mode that runs great, makes great code on any model, and has a UI that doesn't make you want to throw your phone.

**Budget:** $0. All code. No external dependencies beyond what's already in the repo.

---

## Phase 0: UI Unfuck (Week 0-1) — *Do This First*

The current Build Studio UI is broken on mobile, cramped on desktop, and missing basic affordances. Fix this before anything else — you can't evaluate the agent if the UI hides its output.

### Mobile (Critical)
- [ ] **Transcript panel**: Fixed bottom sheet, drag handle, 50%/90% snap points, swipe to dismiss
- [ ] **Plan view**: Horizontal scroll cards (not vertical list), tap to expand, swipe between steps
- [ ] **Tool calls**: Collapsible cards, color-coded by type (read=blue, write=green, shell=amber, browser=purple), show duration
- [ ] **Diff preview**: Full-screen modal, side-by-side on landscape, unified on portrait, syntax highlighted
- [ ] **Progress ring**: Top-center, shows current step/total, pulsates on active
- [ ] **Keyboard avoidance**: Composer stays above keyboard, transcript scrolls
- [ ] **Touch targets**: Min 44×44dp, 8dp spacing, no hover-only actions
- [ ] **Safe areas**: Notch/home indicator padding, env(`safe-area-inset-*`)

### Desktop (Critical)
- [ ] **Three-pane layout**: Plan (left, 320px) | Transcript (center, flex) | Preview/Console (right, 380px, collapsible)
- [ ] **Resizable panes**: Drag handles, persist widths in localStorage
- [ ] **Tool call tree**: Nest under plan steps, expand/collapse, filter by type/status
- [ ] **Live preview**: Iframe with refresh button, console errors overlay, device toolbar
- [ ] **Diff view**: Side-by-side default, inline toggle, line numbers, word diff
- [ ] **Keyboard shortcuts**: `Cmd/Ctrl+Enter` run, `Esc` cancel, `Cmd/Ctrl+.` diff, `Cmd/Ctrl+Shift+P` command palette

### Both
- [ ] **Theme**: CSS variables only, no hardcoded colors, respects `prefers-color-scheme`
- [ ] **Loading states**: Skeleton screens, not spinners
- [ ] **Error toasts**: Top-right, dismissible, action buttons ("Retry", "View Logs")
- [ ] **Accessibility**: ARIA labels, focus management, screen reader announcements for tool results

### Files to Touch
```
artifacts/infinity/src/components/build-studio.tsx          // Main orchestrator
artifacts/infinity/src/components/build-progress-panel.tsx  // Transcript + plan
artifacts/infinity/src/components/build-plan-view.tsx       // Plan cards (new)
artifacts/infinity/src/components/build-transcript.tsx      // Tool call feed (new)
artifacts/infinity/src/components/build-diff-preview.tsx    // Diff modal (new)
artifacts/infinity/src/components/build-live-preview.tsx    // Iframe preview (new)
artifacts/infinity/src/hooks/use-build-studio.ts            // State logic (new)
artifacts/infinity/src/lib/build-ui-theme.css               // Theme tokens (new)
```

---

## Phase 1: Foundation — Agent Survives Everything (Week 1-2)

### 1.1 Git Worktree Isolation (`workspace.ts`)
```typescript
// Each project gets:
// - Own branch: infinity/build/<project-id>
// - Own worktree: WORKSPACE_ROOT/worktrees/<project-id>
// - Own node_modules (symlink to global pnpm store)
// - Atomic commits per iteration with message: "infinity: step 3/7 - add auth middleware"
// - Instant rollback: git reset --hard HEAD~1
// - Cleanup: prune worktrees on project delete
```

**Deliverable:** `workspace.createIsolated(projectId)` returns `{ worktreePath, branch, cleanup }`

### 1.2 Checkpoint/Resume System
```typescript
// DB: lib/db/src/schema/checkpoints.ts
export const buildCheckpoints = pgTable('build_checkpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  iteration: integer('iteration').notNull(),
  plan: jsonb('plan').notNull(),           // Full plan JSON
  completedSteps: jsonb('completed_steps').notNull(), // StepResult[]
  workingContext: jsonb('working_context').notNull(), // WorkingContext
  fileSnapshots: jsonb('file_snapshots'),  // path → content hash (for diff)
  tokenUsage: jsonb('token_usage'),        // { prompt, completion, total }
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Routes: POST /api/infinity/build/checkpoint, GET /api/infinity/build/checkpoint/:projectId
// On boot: auto-resume latest incomplete checkpoint
```

**Deliverable:** Close tab → reopen → "Resume from step 3 of 7?" → exactly where you left off.

### 1.3 Structured Tool Results — *The Quality Multiplier*
```typescript
// build.ts executeTool() returns:
interface StructuredToolResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  parsed: {
    typeErrors: TypeScriptError[]      // tsc --noEmit --pretty false
    testResults: TestResult[]          // vitest --reporter=json
    lintIssues: LintIssue[]            // eslint -f json
    buildArtifacts: BuildArtifact[]    // dist/ files, sizes
    browserLogs: BrowserLogEntry[]     // console.error, network failures
  }
}

// Model sees: "TypeError at src/auth.ts:42: Property 'user' does not exist on type 'Request'"
// Not: 500 lines of raw stdout
```

**Deliverable:** Free models fix 2-3x more errors because they *see* them structured.

---

## Phase 2: Loop Intelligence — Agent Thinks Better (Week 2-3)

### 2.1 Diff Preview + Optional Confirmation
```typescript
// Before writeFile tool commits:
// 1. Generate unified diff (diff-match-patch)
// 2. Emit 'diff-preview' event → UI shows modal
// 3. If config.requireConfirmation: wait for user approve/reject
// 4. On approve: write file, emit 'diff-applied'
// 5. On reject: emit 'diff-rejected', model retries with feedback
// Config: user setting (default: true for mobile, false for desktop power users)
```

### 2.2 Real Verification Loop
```typescript
async function verify(workspace: Workspace): Promise<VerificationResult> {
  const results = await Promise.all([
    runCommand('tsc --noEmit', workspace),           // Types
    runCommand('npm test -- --run --reporter=json', workspace), // Tests
    runCommand('eslint -f json .', workspace),       // Lint
    runCommand('npm run build', workspace),          // Build
  ])
  const passed = results.every(r => r.ok)
  if (!passed) {
    // Feed failures back to model as structured observations
    await feedBackFailures(results, workspace)
    return verify(workspace) // Retry (max 3)
  }
  return { passed: true, details: results }
}
```

### 2.3 Parallel Step Fan-out
```typescript
// Plan schema adds: dependsOn: string[], parallel: boolean
// Execution: topological sort → run independent steps concurrently
const results = await Promise.all(
  independentSteps.map(step => executeStep(step, workspace))
)
// Wall-clock: 3-5x faster for multi-file work
```

### 2.4 Prompt Engineering Overhaul
```typescript
// Modular, versioned, few-shot prompts
const PROMPTS = {
  planner: loadPrompt('planner.v2'),      // Outputs PlanSchema JSON only
  coder: loadPrompt('coder.v2'),          // Self-check: types? tests? errors?
  reviewer: loadPrompt('reviewer.v2'),    // Harsh critic, PASS/FAIL + evidence
  fixer: loadPrompt('fixer.v2'),          // Minimal changes, preserve intent
}
// Chain: plan → code → review → if FAIL: fix → review → verify
// Few-shot examples stored in prompts/examples/*.md
```

---

## Phase 3: Context & Memory — Agent Remembers (Week 3-4)

### 3.1 Smart Working Context
```typescript
interface WorkingContext {
  projectGoal: string
  currentPlan: Plan
  completedSteps: StepResult[]
  keyDecisions: Decision[]           // "Use React Query not SWR"
  fileMap: Map<string, FileSummary>  // path → { purpose, exports, lastChanged, hash }
  errorPatterns: ErrorPattern[]      // "Always forgets to import types from @workspace/db"
  tokenBudget: { used: number, limit: number }
}

// Compaction (every 5 steps):
// - Keep last 5 steps + all decisions + fileMap + errorPatterns
// - Summarize older steps: "Steps 1-10: scaffolded React + TS + Tailwind, added auth pages"
// Retrieval: semantic search (local embeddings, @xenova/transformers) for relevant files
```

### 3.2 Project-Scoped Memory Integration
```typescript
// Reuse existing project-memory system (lib/project-context.ts)
// Inject into Build loop: PROJECT CONTEXT block with:
// - Project instructions (explicit rules)
// - Project memory (learned facts)
// - Recent activity (last 20 actions)
// - File index (all tracked files)
// Isolation: strict projectId filtering, no cross-project leakage
```

---

## Phase 4: Developer Experience — Joy to Use (Week 4-5)

### 4.1 Workspace Snapshots + One-Click Rollback
```typescript
// At each checkpoint: tar.gz workspace (exclude node_modules, .git, dist)
// UI: "History" timeline with diffs, one-click "Restore this version"
// Storage: ~50MB/project for 100 checkpoints (compressed, deduplicated)
```

### 4.2 Browser Pool (Reliable Previews)
```typescript
// 3-5 pre-warmed Chromium instances (puppeteer-extra + stealth)
// Session persistence: cookies + localStorage per project
// Screenshot diffing: pixelmatch for visual regression
// Accessibility tree: CDP protocol, not DOM scraping
// Auto-restart on crash, health check every 30s
```

### 4.3 Resource Limits + Cost Tracking
```typescript
// Per-workspace: CPU quota, memory limit, max iterations, token budget
// Global: daily token budget alert (even on free models)
// Auto-pause: "Approaching limit, confirm to continue"
// Dashboard: /build/stats → tokens, time, iterations, success rate
```

### 4.4 Command Palette + Keyboard Mastery
```
Cmd/Ctrl+K → Command Palette:
- "Run Build" / "Resume Build" / "Cancel Build"
- "Show Diff" / "Open Preview" / "Open Console"
- "Rollback to Step N" / "Export Workspace" / "Clear Checkpoints"
- "Toggle Confirmation" / "Toggle Parallel Mode" / "Model Settings"
```

---

## Phase 5: Polish — Production Ready (Week 5-6)

### 5.1 Telemetry + Debugging
```typescript
// Structured logs: /api/infinity/build/logs/:projectId?format=jsonl
// Events: plan_start, step_start, tool_call, tool_result, verify_start, verify_result, checkpoint, error
// UI: "Debug" panel with filterable event stream, replay capability
```

### 5.2 Export / Share
```typescript
// "Export Build" → ZIP with: source, checkpoints, logs, final diff
// "Share Build" → Read-only link (signed URL, 7-day expiry)
// "Clone Build" → New project from checkpoint
```

### 5.3 Edge Cases Handled
- [ ] Network failure mid-tool → retry with backoff
- [ ] Disk full → graceful pause, clear cache, resume
- [ ] Model API rate limit → queue, notify, retry
- [ ] Git conflict on commit → auto-merge trivial, prompt for complex
- [ ] Workspace corruption → detect, offer restore from snapshot
- [ ] Concurrent builds same project → queue, not parallel

---

## File Map — What Exists vs. What's New

```
EXISTING (modify):
├── artifacts/api-server/src/routes/infinity/build.ts           // Core loop
├── artifacts/api-server/src/lib/workspace.ts                   // Workspace mgmt
├── artifacts/api-server/src/lib/puppeteer-browser.ts           // Browser
├── artifacts/api-server/src/lib/source-code.ts                 // Source reading
├── artifacts/infinity/src/components/build-studio.tsx          // Main UI
├── artifacts/infinity/src/components/build-progress-panel.tsx  // Progress
├── artifacts/infinity/src/hooks/use-chat-stream.ts             // SSE hook
├── lib/db/src/schema/                                          // Add checkpoints table

NEW (create):
├── artifacts/api-server/src/lib/build-checkpoints.ts           // Checkpoint logic
├── artifacts/api-server/src/lib/structured-tools.ts            // Tool result parsing
├── artifacts/api-server/src/lib/build-prompts.ts               // Modular prompts
├── artifacts/api-server/src/lib/build-context.ts               // Working context
├── artifacts/api-server/src/lib/browser-pool.ts                // Browser pool
├── artifacts/api-server/src/lib/workspace-snapshots.ts         // Snapshots
├── artifacts/api-server/src/routes/infinity/build-checkpoints.ts // Checkpoint routes
├── artifacts/api-server/src/routes/infinity/build-snapshots.ts   // Snapshot routes
├── artifacts/infinity/src/components/build-plan-view.tsx
├── artifacts/infinity/src/components/build-transcript.tsx
├── artifacts/infinity/src/components/build-diff-preview.tsx
├── artifacts/infinity/src/components/build-live-preview.tsx
├── artifacts/infinity/src/components/build-history.tsx
├── artifacts/infinity/src/components/build-command-palette.tsx
├── artifacts/infinity/src/hooks/use-build-studio.ts
├── artifacts/infinity/src/hooks/use-build-checkpoints.ts
├── artifacts/infinity/src/lib/build-ui-theme.css
├── prompts/
│   ├── planner.v2.md
│   ├── coder.v2.md
│   ├── reviewer.v2.md
│   ├── fixer.v2.md
│   └── examples/
```

---

## Success Criteria — "Done" Means

| Criterion | Test |
|---|---|
| **Mobile UI usable** | Full build on phone: read plan, see diffs, approve, watch preview |
| **Desktop UI powerful** | Three panes, resizable, keyboard shortcuts, live preview |
| **Survives crash** | Kill server mid-build → restart → "Resume?" → continues |
| **Fixes own errors** | Introduce TS error → agent sees it structured → fixes → verify passes |
| **Parallel projects** | 3 projects building simultaneously, isolated, no conflicts |
| **Long sessions** | 50+ turns, context preserved, no hallucination drift |
| **Verified code** | Every completion: types �� tests �� lint �� build �� |
| **Rollback works** | "History" → click step 3 → workspace exactly as step 3 |
| **Free model quality** | Llama3.2/Nemotron produces production-ready code for typical tasks |
| **No budget** | $0 spent, all self-hosted, BYO keys only |

---

## Dependency Graph

```
Phase 0 (UI) ──────────────────────��
                                   │
Phase 1.1 (Worktrees) ─────────────��──→ Phase 1.2 (Checkpoints) ──��
                                   │                              │
Phase 1.3 (Structured Tools) ──────��──→ Phase 2.2 (Verification)  │
                                   │                              │
Phase 2.1 (Diff Preview) ──────────��──→ Phase 2.3 (Parallel) ─────��──→ Phase 3.1 (Context)
                                   │                              │
Phase 2.4 (Prompts) ───────────────��                              │
                                                                  ��
Phase 3.2 (Project Memory) ←──────────────────────────────────────��
                                                                  │
Phase 4.1 (Snapshots) ←───────────────────────────────────────────��
Phase 4.2 (Browser Pool) ──────────────────────────────────────────��
Phase 4.3 (Resource Limits) ───────────────────────────────────────��
Phase 4.4 (Command Palette) ───────────────────────────────────────��
                                                                    ��
Phase 5.1 (Telemetry) ←────────────────────────────────────────────��
Phase 5.2 (Export/Share)
Phase 5.3 (Edge Cases)
```

---

## Start This Week (Priority Order)

1. **Phase 0: Mobile Build Studio UI** — You can't test anything if the UI is broken
2. **Phase 1.1: Git Worktrees** — Foundation for everything else
3. **Phase 1.3: Structured Tool Results** — Biggest quality jump per hour invested
4. **Phase 1.2: Checkpoints** — Makes the system survivable
5. **Phase 2.1: Diff Preview** — Trust builder
6. **Phase 2.2: Real Verification** — "It works" becomes verified
7. **Phase 2.4: Prompt Overhaul** — Free model quality jump
8. **Phase 3.1: Smart Context** — Long sessions work
9. **Phase 4.1: Snapshots + Rollback** — Fearless iteration
10. **Phase 4.2: Browser Pool** — Reliable previews

---

## Notes

- **No new dependencies** — Everything uses existing stack (Express, React, Drizzle, Puppeteer, pnpm)
- **No external services** — No Browserbase, no MCP servers, no paid APIs
- **Incremental** — Each phase ships value independently
- **Testable** — Every phase has clear success criteria above
- **Mobile-first** — If it works on phone, desktop is easy

---

**This is the plan. No fluff. Every item is code you can write today. Want me to start with Phase 0 (Mobile Build Studio UI)?**