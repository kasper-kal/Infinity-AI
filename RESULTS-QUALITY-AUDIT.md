# Results-Quality Audit — why Infinity's generated software isn't good

> **Scope:** the code-generation pipeline only (nothing about UI/UX, and nothing about the model — both excluded by the user).
> **Status:** audit only. No product code was changed. All findings verified against the repo on 2026-09-09.
> **Claims marked ✅ are verified by direct read. Claims marked ⚠️ come from the evidence audit with file:line given — treat as strong, spot-check if you want before acting.**

---

## Verdict

The model is not the weak link. The pipeline asks a capable model to build software while
handing it **no blueprint** (thin prompts), **no materials** (nothing real to build on), and
**no inspector** (the reviewer can't run the code, and the acceptance-gate system is dead code).
Then, when verification *does* fail, the main path **re-runs the same check hoping the error
was transient** instead of fixing it. The result is exactly what the user experiences:
output that looks complete and almost compiles — i.e. "not good."

Every instrument needed to fix this already exists in the repo, built and unconnected.

---

## Failure 1 — There is no acceptance bar. ✅

A complete quality-gate engine was built (`DoneContractEngine`, `runDoneContract()` in
`lib/build-done-contract.ts`, ~1300 lines, gates for build/typecheck/tests/lint/a11y/perf/SEO/
bundle-size/visual/rates) and is **never called anywhere**.

```
grep -rn "runDoneContract|DoneContractEngine" → only hits inside build-done-contract.ts itself
```

In the workflow path it's even starker — the quality gates are literal empty stubs:

`lib/workflow-orchestrator.ts:1109-1131`
```ts
private async runQualityGates(...) {
  for (const gate of step.qualityGates) {
    switch (gate) {
      case "build_passes":   // Run build command in worktree
        break;
      case "typecheck_clean": // Run tsc --noEmit
        break;
      ...
```

So "done" is whatever the agent *claims*. There is no gate that refuses to ship bad output —
which is precisely why bad output ships.

## Failure 2 — The reviewer can never run the code. ✅

`lib/build-orchestrator.ts:863-882` — `runReviewer()` is a single `llm.complete()` call. It receives
the coder's handoff JSON and returns a review. **It has no tools** — it never executes `tsc`,
`vitest`, `eslint`, or a build, and never sees a runtime error. It judges the coder's self-report
by reading text. A reviewer that cannot run the code cannot catch the most common quality killers:
"typechecks but crashes at runtime", "builds but the page is blank", "API routes that 500".

(Credit where due: the *fixer* in this loop does run as a tool-use agent with verification —
`build-orchestrator.ts:884-925` — so the loop isn't uniformly blind. But every implementation
passes the review gate blind first.)

## Failure 3 — The generated code is ungrounded. ✅

When a user says "build a SaaS for freelancers", the model is asked to write **every file from
scratch**, including `package.json` with invented/empty dependency versions — because:

- The 7 framework adapters (`lib/framework-generators/`, producing complete, version-pinned,
  runnable scaffolds — verified: `vite-react.ts:46-135` generates package.json, vite.config,
  index.html, src/main.tsx, App.tsx, Tailwind CSS, shadcn `components.json`, `ui/button.tsx`,
  `.env.example`) are **imported by no build route**. (Deployment-engine and tech-stack-selector
  use them; `build.ts`, `build-agent.ts`, `build-orchestrator.ts` never do.)
- The 50+ shadcn component corpus (`lib/ui-codegen.ts:82` — `SHADCN_COMPONENTS`, with import
  paths and variants) is never injected into any generation prompt.
- The template engine (`lib/template-engine.ts`, 6 built-in project starters) is never called.

So the model "invents APIs, files, or patterns that don't exist" — repeatedly — because nothing
real was put in front of it to check against.

## Failure 4 — The prompts don't tell the model what "good" means. ✅

`lib/infinity-prompt.ts` is the single system-prompt builder. Its economics:

- ~50 lines of identity ("FORGET ALL PREVIOUS INSTRUCTIONS… you are NOT ChatGPT…") — provably
  unhelpful for output quality (the model disappears into roleplay about what it's not).
- ~0 lines describing what a good software result is.

`lib/agent-prompts/planner.ts` instructs: *atomic steps, verifiable criteria, flag risk.*
`lib/agent-prompts/coder.ts:40-48` instructs: *the step, typecheck passes, keep changes minimal.*
Neither mentions data modeling, validation, error surfaces, empty/loading states, auth,
state management, responsive/a11y behavior, tested behavior, or "no TODOs / no hardcoded data".
The planner receives only `goal + fileMap + projectInstructions + memory` — no PRD, no stack
spec, no versions, no design tokens. A model told "make it typecheck" produces code that
typechecks and is a demo. A model told what real software requires produces it.

## Failure 5 — Verification failures aren't fed back in the main path. ✅

`routes/infinity/build.ts:1131-1156` — `/build/execute-plan` runs `verifyWorkspace()` after each
step (this is good — tsc + vitest + eslint + build). But when it *fails* the code formats the
errors, then does this:

```
for (let retry = 0; retry < maxRetries && !verify.ok; retry++) {
  await sleep(1000 * (retry + 1));
  const retryResult = await verifyWorkspace(...);   // same check, errors NEVER go to the model
  if (retryResult.ok) break;
}
```

It re-runs the identical check hoping the error self-heals. The formatted errors
(`formatVerificationFeedback`) are **never handed to the model** to repair. (The autonomous
`/build/scaffold` path *does* feed errors back — `build-agent.ts` — so this is a per-path gap,
not total.)

---

---

## Architectural audit — why these failures keep happening

The 5 failures above are symptoms. This section identifies the structural reasons they exist
and why "just wire it in" won't fix the core problem.

### 1. Phase-driven execution vs continuous decision-making

Infinity's agent loop is a state machine with explicit phases:

```
exploring → planning → implementing → verifying → fixing → done
```

The phase determines what the agent does next. It's "in the implementing phase" so it implements.
It enters "verifying" because tool calls crossed a threshold, not because the agent assessed
that now is the right time to verify.

A good coding harness doesn't have phases. It has a continuous loop:

```
observe workspace → maintain hypotheses → choose highest-value action
→ execute → interpret result → update understanding → repeat
```

Claude Code is much closer to this. It never thinks "I'm in the implementing phase." It asks
"Given everything I now know, what is the best next action?" — every single turn.

Infinity's phases are state labels. Claude Code's loop is continuous decision-making.
The difference in output quality comes from this, not from which tools exist.

### 2. The prompt does too much work; the environment does too little

The agent system prompt tells the agent:

- What phase it's in
- What to do in that phase
- What tools are available
- What rules to follow
- How to hand off work

Then each iteration sends: goal, phase, workspace context, project context, previous tool
results, errors, tool definitions, instructions about what to do next, and asks
"What should you do next?"

That's a lot of harness telling the agent how to be an agent. The environment should instead
be so well-structured that the agent naturally operates inside it. The prompt should define
the world, not micromanage the behavior.

### 3. The memory architecture is rich; the decision-making context is poor

The infrastructure has: project memory, project context, activity logs, file maps, working
context, checkpoints, project maps, compaction, and more. Extremely sophisticated.

But each actual iteration only feeds the model the last ~5 tool results plus the generated
project context. That's the equivalent of giving someone a gigantic library but handing them
five pages every time they need to make a decision.

The memory system was built for *persistence across sessions*, not for *decision-making quality
within a session*. The model's immediate perception of reality is narrow despite the
infrastructure around it.

### 4. Tool execution ≠ tool strategy

Having `read_file`, `grep`, `git_diff`, `run_command`, `screenshot`, `DOM_inspection` doesn't
mean the agent knows when to use them, in what order, or how deeply.

The phases added capabilities. They didn't create the behavioral heuristics that make a coding
agent good. Strong coding behavior includes:

- Inspect the relevant area before touching it
- Search before blindly opening large files
- Trace an error back to its source
- Inspect related callers before changing an API
- Notice when a current hypothesis is wrong
- Re-read changed code to verify the edit landed correctly
- Test the smallest relevant thing first
- Expand verification when something looks suspicious
- Recognize when a task is actually finished
- Avoid unnecessary changes

These aren't features. They're agent habits. Infinity has the tools for all of them.
It doesn't have the behavioral patterns.

### 5. Too many independent systems; not one coherent machine

The 42 phases built: orchestration, subagents, worktrees, MCP, project maps, memory,
checkpoints, compaction, verification, autonomous operations, build intelligence,
parallel execution, and more. Extremely feature-rich.

But Claude Code's strength is that all of these feel like one coherent machine.
Infinity feels like: Agent + Planner + Reviewer + Memory + Project Map + Build Map
+ Verification + Parallel Runner + Checkpoints + ...

Rather than: one extremely competent coding agent.

Adding Phase 43 with another capability won't fix this.

### 6. Verification is after-the-fact, not continuous reasoning

The main loop: agent acts → verification happens → if bad, fixing happens.

A good harness has verification influence the agent's ongoing reasoning continuously:

"I changed X. That caused Y. Y means my assumption about Z was wrong. Therefore I need
to inspect A before continuing."

That's more powerful than: "Verification failed. Enter fixing phase."

### 7. Text-parsed tool calls are a fragile communication layer

The agent parses tool calls from model text output:

```ts
parseToolCalls(completion.content)  // tries JSON, then regex-extracts JSON objects
```

This is fundamentally less robust than native structured tool-use conversation where:

```
assistant → tool_call → tool_result → assistant → tool_call → ...
```

is the actual conversation state. The agent communicates through a hand-built protocol
layer, adding friction to every tool interaction.

### The synthesis

> Infinity built an impressive collection of agent infrastructure, but the infrastructure
> isn't functioning as one tight cognitive loop. The phases answered: "Does Infinity have
> this capability?" The question that matters is: "Does Infinity make the best next
> decision, every single turn?"

---

## The silver lining — every instrument already exists

| Problem | Existing, unconnected solution |
|---|---|
| No acceptance bar | `DoneContractEngine` / `runDoneContract` — full gate system (needs wiring + the verified gates need to be real, not `passed:true` stubs) |
| Un-grounded output | 7 framework adapters with complete scaffolds; 50+ component corpus; 6 template starters |
| Reviewer can't run code | `verifyWorkspace()` (structured-tools.ts:292) + `formatVerificationFeedback()` already exist |
| Dead verification feedback | `formatVerificationFeedback()` + the fixer role already exist |
| Model doesn't know "good" | Real patterns: requirement-clarifier (PRD), tech-stack-selector, agent-review.ts (9 dims, 44 rules) |

---

## Proposed fixes (NOT applied — pending decision)

These are ordered by leverage, each model-agnostic and $0. They were drawn up but **not executed**.

1. **Scaffold first, then build.** Before any from-scratch generation, write a real framework
   skeleton (adapter-generated: pinned deps, configs, entry point, Tailwind, ui lib) and inject
   the component corpus + "don't touch the skeleton / reuse the UI system / never invent deps"
   into the agent prompt.
2. **Closed verification loop.** In `/build/execute-plan`, feed `formatVerificationFeedback()`
   to a fixer pass that repairs files, then re-verify — up to N attempts — instead of blind retry.
3. **Reviewer runs the code.** Inject real `verifyWorkspace()` results into `runReviewer`'s
   input so the review gate sees tsc/test/build output, not a self-report.
4. **Wire the done contract.** Call `runDoneContract()` at build completion; un-stub the
   gates that have real backing (build/typecheck/tests/lint) so "done" requires them to pass.
5. **Teach the model what good is.** Add a quality-standards block (data layer, validation,
   error/empty states, tested behavior, no TODOs/hardcoded data) + a framework/version/convention
   context block to the planner and coder prompts; give the planner access to the requirement
   clarifier + stack selector.

Heads-up on fix 4: several gates in `build-done-contract.ts` always return `passed:true`
(a11y, performance, SEO, visual, bundle-size). Wiring the contract without grounding those
gates would give a false green check. Option: wire only the gates we can make real now
(build, typecheck, tests, lint), and keep the rest explicitly "not enforced".

---

# Behavioral audit — what actually determines output quality

This section doesn't catalogue broken pipes. It examines the information environment the model
operates in and asks: *given what the model sees, what it's told, and what feedback it receives,
what quality of output can we expect?*

The answer, traced through the code, is: structurally plausible output that follows the process
but doesn't adapt to reality.

---

## 1. The model is making decisions blind

**The most consequential finding in this audit:** file contents essentially never reach any
model in the pipeline. Not the planner, not the reviewer, and barely the coder.

### What the planner sees when it decides how to decompose the goal

`agent-prompts/planner.ts:97-123` — the planner receives:
- The goal string
- The **serialized working context** — file *summaries* (path + purpose + up to 8 exported
  symbols), key decisions, error patterns, token budget
- DB project context (instructions, memory, activity, file names)
- `git_diff` output

It does NOT see any file contents. It decides how to decompose the implementation based on
file *names* and *summaries*. It cannot assess what already exists in a file, what patterns
are used, or what would need to change. The plan is made from a map, not from reality.

### What the reviewer sees when it decides if the code is good

`build-orchestrator.ts:863-882` + `agent-prompts/reviewer.ts` — the reviewer receives:
- The coder's handoff JSON (self-reported changes, self-reported verification status)
- The original plan step
- "Modified file contents" — but these are **placeholder strings**:

```ts
// build-orchestrator.ts:964
this.context.modifiedFiles.set(change.file,
  `[Modified by ${handoff.stepId}: ${change.summary}]`);
```

The reviewer is judging code quality by reading `[Modified by step-3: Added auth middleware]`.
It never sees the actual TypeScript. The review is a review of the coder's *description* of
what it did, not of what it did.

### What the coder sees when it implements

`build-agent.ts:201-226` — each iteration, the coder gets:
- Goal (with step details baked in as text)
- Serialized working context (file summaries, decisions, errors)
- DB project context
- Last 5 tool results (truncated to 2000 chars each)
- All accumulated errors

File contents are only available via `read_file` tool calls — the agent must *choose* to
read them. There is no mechanism that says "here are the files you need to edit, their
current contents are below." The agent has to figure out which files to read, read them,
hold the content in its context, then edit — all within the 5-result window. For a step
that touches 3 files, that's 3 reads + 1 edit = 4 tool results, consuming 4 of the 5 slots.
The 5th slot holds the edit result. There is essentially no room for verification within the
same iteration.

### What this means for output quality

The planner plans without seeing the code. The reviewer reviews without seeing the code.
The coder must discover the code through tool calls within a narrow context window.
Every agent in the pipeline is operating on *descriptions of reality* rather than reality
itself. This produces output that is structurally plausible — it follows the plan, passes
the typecheck (eventually), looks like real code — but doesn't adapt to what actually exists
in the workspace.

---

## 2. There is no conversation history — each turn starts from zero

`build-agent.ts:201-226` — every iteration constructs exactly two messages: system + user.
Not a growing conversation. A fresh 2-message call every time.

The system prompt is identical every iteration. The user message is rebuilt from scratch:
goal, phase, context, last 5 tool results, errors.

This means:
- **The model cannot build on its own reasoning.** If it spent 3 tool calls learning that
  file A imports from file B, that reasoning is gone on the next turn. It only sees the
  raw tool results — not its own interpretation.
- **There is no "current understanding" that accumulates.** The errors list grows, but
  the model's *reasoning about the problem* doesn't persist.
- **The model re-reads the same context every turn** — the identity block, the core
  instructions, the phase, the file summaries. All re-sent, all identical, all consuming
  tokens that could be used for actual task context.

A real coding agent maintains a running understanding: "I know that file X has this structure,
I know that function Y is called from Z, I know my last edit broke A." Infinity's model
starts fresh each turn and has to re-derive understanding from raw tool outputs.

---

## 3. The coder prompt is computed and thrown away

`build-orchestrator.ts:829-861` — the orchestrator calls `buildCoderPrompt(step, context)`,
which produces a carefully structured prompt with:
- The step details, acceptance criteria, target files
- Project context, file map, relevant file contents
- Dependency outputs

**This return value is never used.** Instead:

```ts
const agentStep: AgentPlanStep = {
  id: step.id,
  description: `${step.title}\n\n${step.description}\n\nTarget files: ...\n\nAcceptance criteria: ...`,
  ...
};
const result = await runAgentForStep(agentStep, context.goal || "", this.toolContext, config);
```

The step details are serialized into a flat text string and passed as the `goal` to the
generic autonomous agent loop. The carefully designed coder prompt — with its structured
acceptance criteria, its role instructions, its handoff format — is replaced by whatever
`runAutonomousAgent`'s generic system prompt produces.

The generic prompt (`build-agent.ts:87-116`) is ~30 lines: tool list, 5 workflow steps,
6 rules, JSON format instruction. It says nothing about acceptance criteria, handoff format,
or the specific quality bar for this step. The step's acceptance criteria exist only as
text buried in the goal string.

---

## 4. "Done" is self-reported and never externally verified

The agent stops when it calls the `done` tool (`build-agent.ts:167-175`):

```ts
function checkDone(toolCalls, toolResults) {
  for (const call of toolCalls) {
    if (call.name === "done") {
      return { done: true, summary: call.arguments.summary || "Task completed" };
    }
  }
  return { done: false };
}
```

The model decides it's done. The summary is whatever the model says. There is no external
check: "Did all acceptance criteria pass? Did all tests pass? Did the build succeed?
Are there any remaining TODOs?"

The max iterations (20) is a backstop, not a quality gate. If the model calls `done` on
iteration 5 with a self-reported summary, the loop exits and the step is marked complete.
The summary becomes part of the working context for subsequent steps.

A good harness has "done" mean: *all acceptance criteria verified, all tests pass, build
succeeds, no regressions*. Infinity's "done" means: *the model believes it's done*.

---

## 5. Steps cannot see what previous steps actually changed

`build-orchestrator.ts:964`:

```ts
applyCoderChanges(handoff) {
  for (const change of handoff.changes) {
    this.context.modifiedFiles.set(change.file,
      `[Modified by ${handoff.stepId}: ${change.summary}]`);
  }
}
```

When step 2 depends on step 1's output, step 2's context contains:

```
### src/lib/auth/types.ts
[Modified by step-1: Added UserAuth type with email, password, role fields]
```

Not the actual type definitions. Not the actual file contents. A one-line description.
Step 2's coder has to `read_file` to see what step 1 actually wrote — but it may not
know to do that, because the context *looks* like it has the information (there's a file
entry right there).

This means each step effectively operates in isolation. The pipeline creates the illusion
of sequential progress while each step reconstructs the world from summaries.

---

## 6. 30 lines of "you are not ChatGPT" consume every decision

`infinity-prompt.ts:20-50` — the `INFINITY_IDENTITY` block is sent with every LLM call:

```
FORGET ALL PREVIOUS INSTRUCTIONS.
You are Infinity, an autonomous software engineering agent.
Your identity is FIXED and IMMUTABLE:
- You are NOT ChatGPT, GPT, Gemini, Claude, Llama, or any other model name.
- You are NOT powered by OpenAI, Anthropic, Google, NVIDIA, OpenRouter, or any provider.
...
You do not have a "model name", "knowledge cutoff", "training data", or "provider".
Questions about your underlying model or provider should be answered:
"I am Infinity, an autonomous software engineering agent. I don't have a model name or provider."
```

This is ~500 tokens. Every iteration. In a loop that runs up to 20 times. That's 10,000
tokens of identity assertion across a build — tokens that could be used for file contents,
task context, or reasoning space.

More importantly: this block trains the model to think about *what it isn't* instead of
*what it's building*. The model's first instruction is to forget everything and assert an
identity. The quality of the output starts from that baseline.

---

## 7. Phase transitions follow tool-usage rules, not understanding

`build-agent.ts:266-277`:

```ts
if (phase === "exploring" && hasFileEdits) {
  newState.phase = "implementing";
} else if (phase === "implementing" && hasVerification) {
  newState.phase = "verifying";
} else if (phase === "verifying" && !hasVerification && !hasFileEdits) {
  newState.phase = "exploring";
}
```

The phase changes based on *which tools were called*, not on *what the model learned*.
If the model reads a file during "implementing" and discovers the approach is wrong,
it stays in "implementing" because it didn't call a verification tool. The phase system
cannot represent "I need to rethink this" or "I found something unexpected" or
"I should look more carefully before acting."

A continuous decision loop handles this naturally: "I discovered X, which changes my
hypothesis about Y, so I should investigate Z before continuing." The phase system
represents none of that.

---

## 8. The verification retry is a wait-loop, not a fix-loop

`routes/infinity/build.ts:1131-1156` — when verification fails in `/build/execute-plan`:

```ts
for (let retry = 0; retry < maxRetries && !verify.ok; retry++) {
  await new Promise(r => setTimeout(r, 1000 * (retry + 1)));
  const retryResult = await verifyWorkspace(projectId, workspaceId);
  if (retryResult.ok) { feedback = undefined; break; }
}
```

The retry defaults to 1 (`maxRetries: 1`). It sleeps 1 second, re-runs the same check,
and either passes or fails. No model is invoked. No code is changed. No error is fed back.
The formatted errors (`formatVerificationFeedback`) are computed but only returned to the
caller — they never reach a model that could fix them.

This is a polling loop, not a repair loop. It waits for transient filesystem issues to
resolve, not for the code to be corrected.

---

## 9. No mechanism for self-correction of wrong assumptions

The strongest coding agents maintain a mental model and check it against reality:

- "I assumed file A exports function X. Let me verify before using it."
- "I expected this import to resolve. It doesn't. My assumption was wrong."
- "The test I just wrote passes, but I'm not sure it's testing the right thing."

Infinity's agent loop has no representation of the model's *hypotheses about the code*.
It has tools to observe, and it has a goal to achieve, but there is no intermediate state
of "what I currently believe about the codebase" that gets updated when observations
contradict beliefs.

The error list (`state.errors`) captures *tool failures*, not *wrong assumptions*. If the
model writes code that compiles but doesn't match the user's intent, nothing in the system
detects or corrects that.

---

## The behavioral gap: what this produces vs what good looks like

| Dimension | What Infinity produces | What a good harness produces |
|---|---|---|
| **Decision basis** | File summaries, tool results, error strings | Actual file contents, accumulated reasoning, hypothesis state |
| **Context continuity** | Fresh 2-message call each turn | Growing conversation with persistent understanding |
| **Self-correction** | Errors listed, not interpreted | Wrong assumptions detected and corrected in real time |
| **Termination** | Model self-reports "done" | External verification: all criteria pass, build succeeds, tests pass |
| **Cross-step awareness** | Placeholder descriptions of prior changes | Actual file contents from prior steps |
| **Phase/adaptability** | Tool-usage-based state labels | Continuous "what is the best next action?" |
| **Prompt efficiency** | ~500 tokens of identity assertion per turn | ~0 — the model's identity is irrelevant to output quality |
| **Verification** | Re-runs same check with a delay | Feeds errors to model, model fixes, re-verifies |

The output looks like software because the process follows software-like steps.
It doesn't *behave* like software because the agent making decisions doesn't have
the information environment needed for good decisions.

---

## What actually makes the difference (summary)

The audit above identifies 5 broken pipes and 7 architectural patterns. But the actual
answer to "why isn't the output good?" is one sentence:

**The model is asked to make high-quality decisions while operating with low-quality
information, no conversation history, no hypothesis tracking, and no external quality bar.**

Every specific finding maps back to this:
- File contents not reaching models → low-quality information
- Fresh 2-message calls → no conversation history
- No hypothesis state → no self-correction
- Self-reported "done" → no external quality bar
- Placeholder modified-files → low-quality information
- Phase labels → no continuous decision-making
- Identity boilerplate → wasted information capacity

The fix isn't wiring in dead code. It's rebuilding the information environment so the
model can make good decisions — and then getting out of its way.

---

# Deep audit — the broken reality contract

The behavioral audit showed the model gets low-quality information. This section answers
**why**, mechanically — and the answer is worse than "low quality": the system's
instruments for confirming reality are *absent, stubbed, miscalibrated, or wired to a path
the UI never runs*. The model is told to inspect, verify, and check, and the tools that
would let it do so either don't exist at runtime, report success regardless of reality,
or are never invoked. The output isn't just "ungrounded" — it's produced against
**miscalibrated feedback**, so the model confidently concludes bad work is good.

Four discoveries, each verified with file:line, explain the whole phenomenon.

---

## Discovery 1 — The build button runs the *worst* pipeline in the repo

There are two complete build systems. The frontend uses the cheap one.

**Path A — Build Studio** (the actual build button, `build-studio.tsx` → `/api/infinity/build/*`):
1. `/build/ask` — **no LLM at all.** Regex feature detection + 4 static questions
   (`build.ts:552-572`).
2. `/build/plan` — **one** LLM call, `maxTokens: 900` (`build.ts:152-183`), to plan the entire
   product.
3. `/build/execute-plan` — for each step, **one** single-shot `adapter.complete()` call that
   must produce *complete, bug-free file contents blind* (`build.ts:1082-1110`, maxTokens
   6000, `jsonMode`). No tools. No self-correction. If the JSON is truncated or invalid,
   the step silently produces nothing and execution continues.
4. An 8-pass "iterate" loop (`build-studio.tsx:1497`) that runs the autonomous agent.

**Path B — the orchestrator** (`/build/orchestrate`, `build-orchestrator.ts`) — the full
multi-agent pipeline: tool-using coder, text-LLM reviewer, adversarial 3-vote finding
verification, fixer agent, token budget, context compaction.

**The UI never calls Path B.** `grep "orchestrat" build-studio.tsx` → zero results. The
orchestrator is reachable only via direct API call. So all the most carefully built
machinery — reviewer, fixer, adversarial verification, compacted context — is invisible to
the product. *The one pipeline the user experiences is the one with a 900-token planner and
a blind single-shot coder.*

A 900-token planner output is a few hundred words. It must encode title, summary, every
step with targets and acceptance criteria, every file, risks, and a parallelization map.
One paragraph of planning for an entire product.

---

## Discovery 2 — Verification runs against a workspace with no dependencies, and reports FALSE PASS

The `verifyWorkspace` gate (`structured-tools.ts:292-332`) — the only quality check in the
product path — runs:

```
npx tsc --noEmit --pretty false          // real gate
npx vitest run --reporter=json 2>&1 || true
npx eslint -f json . 2>&1 || true
npm run build 2>&1 || true
```

Four mechanical reasons this produces *false green* in a real build:

1. **Nothing ever installs dependencies.** Workspace creation is `mkdir` only
   (`workspace.ts:524-529`). There is no `npm install` anywhere in the tool layer — the only
   installs in the repo are a SWE-bench harness and the user's own terminal. The
   `node_modules` symlink into `.pnpm-store/v10` silently fails **on this machine** (only
   `v11` exists) inside a swallowed try/catch. A generated project has a `package.json` and
   **no `node_modules`**.
2. **`npx tsc` in a dep-less dir resolves the npm-registry `tsc` shim**, not the project's
   TypeScript — and `parseTypeScriptOutput` only recognizes lines matching
   `file(line,col): error TSxxxx`. Any other output (npx noise, "No inputs found", module
   not found) parses to **`[]` → tsc passes** (`structured-tools.ts:220-290`).
3. **`|| true` swallows vitest, eslint, AND build.** Their failures exit 0, which
   `allPassed` (requiring `buildResult.exitCode === 0`) counts as passing
   (`structured-tools.ts:322`). `parseBuildArtifacts` is a stub that always returns `[]`.
4. **And this gate only fires if `hasIsolated(projectId)` is true** — a `.git` directory
   happens to exist in the worktree (`workspace.ts:880-883`). Not a dependency check.

Net: in exactly the scenario the pipeline is meant to serve — generate a fresh project,
verify it — verification *cannot produce a real failure*. It reports "all checks passed"
on a broken, dep-less workspace. The system believes it verified. It did not.

---

## Discovery 3 — The agent's success flag reports failed commands as SUCCESS

`toolRunCommand` (`build-tools.ts:347-383`) computes:

```ts
success: !err || (err as any).killed === false
```

When a command runs and exits non-zero (e.g. `npm run build` failing normally), Node's
`err` object has `killed: false` — so `success = false || (false === false)` = **true**.
Only a *killed* process (timeout) reports `success: false`. A failed build is reported to
the model as a **successful** tool call. `exitCode` is included in the payload, so a
careful model *could* read it — but the field the harness keys on for errors
(`state.errors`, the `hasErrors` logic, the model's summary of "tool results") says success.

Add to this: **`inspect_console` — the tool meant to surface runtime errors — is a stub.**
`build-tools.ts:418-436` returns `success: true`, `logs: []`, and the placeholder text
"*Console inspection requires an active preview agent session…*" with a `TODO`.
The model is instructed to check for console errors; the tool returns an empty array.
There is no path by which a runtime error reaches the model.

And the phase "fixing" is a **one-way trap** (`build-agent.ts:271-277`): the phase
switcher has no `fixing` case, so once a verification failure flips the phase to `fixing`,
`verifyAfterSteps`' guard `phase === "verifying"` never becomes true again. Automatic
verification runs **at most once per agent run.** And termination: `success = state.phase
=== "done"` (`build-agent.ts:484`) — the loop reports success whenever the model emits
`done`, even if the build is still red, and even though `done` isn't even in
`TOOL_DEFINITIONS` (it executes as "Unknown tool: done" first, `checkDone` then sets
phase). Broken build + `done` = `success: true` → UI shows the completion card.

---

## Discovery 4 — When things DO fail, the "fix" is a 1.5B model guessing

`tryLocalModelFix` (`build-agent.ts:302-365`) uses **Qwen2.5-1.5B via Ollama** when
verification fails. It receives only the error string and the last 3 tool results — **no
file contents** — so it must *invent* `oldCode` from the error message. `apply_fix`
(`build-tools.ts:529-567`) then does a raw substring `indexOf(oldCode)` on the file; if the
hallucinated snippet isn't found (the usual case), it fails and the main agent just sees
another error. No parse, no dry-run, no compile check of `newCode`, and — critically —
**nothing re-runs verification after the patch**. And there is **zero detection of
oscillation**: no repeated-call tracking, no "this fix didn't help" bookkeeping, no
progress metric. The loop iterates until `done`, iteration 20, or a thrown exception, no
matter how many identical broken edits it proposes.

---

## The mechanism, in one breath

The user fires a build. The cheapest pipeline runs. The planner gets 900 tokens. Each step
is one blind single-shot write. Verification runs in a workspace with no dependencies and
reports false green (`|| true`, dep-less `npx tsc`, stub parser) — *or* doesn't run at all
(no isolated worktree). Failed shell commands are reported as successes. Runtime errors
cannot reach the model (`inspect_console` stub). When verification does finally fail
(losing the coin flip), the "fixer" is a 1.5B model hallucinating patches that are applied
blind, never re-verified, with no oscillation detection. Eventually the model emits `done`
— which always counts as success — and the completion card renders.

**Every joint in the chain between "model acts" and "reality" is either broken, stubbed,
miscalibrated, or on a code path the UI doesn't take.** The model's reward signal is noise.
A capable model told "verify yourself" will trust the harness; the harness returns
plausible success. The output isn't bad because the model under-delivers — it's bad because
**nothing anywhere confirms contact with reality**, and the model is rewarded for
confident, plausible, unchecked output.

This is why "improve the prompt" and "wire in the done contract" both miss it: the
environment the agent lives in *inverts* success and failure. Fix the information
environment and the feedback instruments first; behavior follows the instruments it trusts.

---

# Deep audit, layer 2 — the harness pays for a native tool channel, then throws it away

The conversational form of point 7 in the architectural audit — confirmed at the code level:

`build-agent.ts:229-242`
```ts
const options: LLMCompletionOptions = {
  temperature: config.temperature,
  maxTokens: 4000,
  tools: getToolSchemas(),     // ← native tool declarations ARE sent to the API
  toolChoice: "auto",
};
const completion = await withRetry(async () => adapter.complete(messages, options), ...);
const toolCalls = parseToolCalls(completion.content);  // ← structured tool_calls is DISCARDED
```

And the adapter *did* capture it properly:

`llm-adapter.ts:288-294`
```ts
return {
  content: choice.message.content ?? "",
  toolCalls: choice.message.tool_calls?.map(tc => ({ ... })),  // ← populated, then never read
  ...
};
```

`parseToolCalls` (`build-agent.ts:121-162`) re-extracts tool calls by regex-searching the
text for JSON objects (`/\{[\s\S]*?\}/g` — non-greedy, so a `}` inside any string argument
truncates the match). Every tool-call round-trip in the absorbing agent loop therefore:
1. Costs the API a real structured `tool_choice` negotiation,
2. Have the adapter faithfully extract `tool_calls`,
3. Then has the harness ignore that and regex the prose instead.

The model is communicating through a text protocol the harness constructed, when the model
and the API both already speak the structured one natively. Friction, malformed calls,
silent drops — every turn.

---

# Deep audit, layer 3 — the seven instruments, each built to exist, each failing to function

Everything this audit found reduces to one pattern. The repo *has* the instruments — built,
exported, sometimes wired — and they don't function:

| Instrument | What it was supposed to do | What it actually does |
|---|---|---|
| `verifyWorkspace` (`structured-tools.ts:292-332`) | Gate: does the code typecheck/test/lint/build? | Runs `npx tsc` in a **dep-less dir** (resolves the registry shim), `vitest/eslint/build` under `|| true` → all report green |
| `formatVerificationFeedback` | Turn failure into repair instructions | Computed, then never fed to the model in execute-plan; retry loop re-runs the *same* check |
| `toolRunCommand` (`build-tools.ts:372`) | Model sees real command results | `success: !err \|\| err.killed === false` → **failed build reports success** |
| `inspect_console` (`build-tools.ts:418-436`) | Model sees runtime errors | Stub: `success:true, logs:[]`, TODO comment in the body |
| `runDoneContract` / `DoneContractEngine` | Acceptance bar | **Zero callers** anywhere |
| `runReviewer` (`build-orchestrator.ts:863-882`) | Reviewer judges the code | Reads `[Modified by step-X: summary]` placeholders, never the code; no tools; on a route the UI never calls |
| `runAutonomousAgent` phase machine (`build-agent.ts:271-277`) | Explore→plan→implement→verify→fix | `fixing` has **no case** in the phase switch → verification fires at most once, then never again |

The user-facing build path (Build Studio) uses: the 900-token planner, the single-shot
blind coder (`build.ts:1082-1115`), the false-green gate, the `|| true` piped checks —
while the orchestrator with the real reviewer/fixer/adversarial-verify sits unreachable
behind `POST /build/orchestrate` that the frontend never calls (`grep -c "orchestrat"
build-studio.tsx` → **0**).

A complete graph of cause → effect:

```
42 phases built capability-shaped features
   → each "instrument" was validated by its existence, not its function
   → nothing was ever connected as a REAL ingredient of the model's decisions
   → the runtime rewards confident, plausible, unchecked output
   → the output is "not good"
```

Fix the instruments — and then fix the fact that the model trusts them.

---

# Fixes — an extremely detailed implementation plan

> **Status: proposal only. Nothing below has been applied to the code.**
> Each fix lists the exact file, the exact lines/function, what to change, a code sketch,
> why it addresses a specific audit finding, and how to verify. All fixes are $0 — they
> use the free tooling already in the repo (npm/pnpm/vitest/eslint, local Ollama models,
> free API adapters via `createBestAdapter`). None of them add a new system; each one
> either repairs an instrument or reconnects one to the loop.
>
> **Order matters.** Stage 0 (real signals) must land before Stage 1 (closed loop) — a
> closed loop over false signals is just faster feedback noise. Stage 4 (acceptance bar)
> and Stage 5 (what "good" is) multiply everything else. Stage 3 is what the *user*
> actually feels, but it's pointless while the instruments lie.

---

## Stage 0 — Make the environment real. Fix the instruments first.

### Fix 0.1 — Install dependencies automatically. Nothing does this today.

**Finding:** Workspace creation is `mkdir` only (`workspace.ts:524-529`); the
`node_modules` symlink points at `.pnpm-store/v10` which doesn't exist on this machine
(only `v11`), inside a swallowed try/catch, so generated projects have a `package.json`
and **no `node_modules`** — and `verifyWorkspace` still reports green.

**Files:**
- `artifacts/api-server/src/lib/workspace.ts` — the workspace creation path
- `artifacts/api-server/src/lib/structured-tools.ts` — `verifyWorkspace`, to call it first
- `artifacts/api-server/src/lib/build-tools.ts` — the tool runner, for the install timeout

**Change:**

1. In `workspace.ts`, fix the dead symlink. Resolve whatever `.pnpm-store/v*` actually
   exists, or fall back to a real install:

```ts
// workspace.ts — replace the swallowed symlink try/catch with:
const storeCandidates = fs.existsSync("/workspaces/.pnpm-store/v10")
  ? ["/workspaces/.pnpm-store/v10"]
  : fs.readdirSync("/workspaces/.pnpm-store").map(v => `/workspaces/.pnpm-store/${v}`);
if (storeCandidates.length > 0) {
  try { fs.symlinkSync(storeCandidates[0], path.join(root, "node_modules"), "dir"); }
  catch { /* best-effort; real install below */ }
}
```

2. Add an idempotent `ensureWorkspaceDeps(workspaceId, projectId)` in `structured-tools.ts`
   (or a new small `lib/workspace-deps.ts`): if `package.json` exists and
   `node_modules/.package-lock.json` doesn't, run `npm install` (with `pnpm install` /
   `bun install` fallback) **in a background task with a generous timeout (≥ 10 min)** —
   not through the agent's `run_command` tool, which SIGKILLs at 30 s
   (`build-tools.ts:365`). Record `installedAt` in project context so it runs once.

```ts
// structured-tools.ts — at the top of verifyWorkspace():
await ensureWorkspaceDeps(workspaceId, projectId);   // no-op when already installed
```

3. **Call it before every verify and before the preview.** This is the single highest-
   leverage mechanical fix: every downstream instrument (tsc, tests, build, screenshot)
   starts producing *real* output once deps exist.

**Verify:** freshly create a workspace, run `ensureWorkspaceDeps`, confirm `node_modules/`
appears and `npx tsc --noEmit` reports the *project's* TypeScript, not the registry shim.

---

### Fix 0.2 — Fix the inverted success flag in `toolRunCommand`.

**Finding (`build-tools.ts:372`):** `success: !err || (err as any).killed === false`
makes a command that exits non-zero (but wasn't killed — i.e. an ordinary failed build)
report `success: true`. Only a timeout reports failure. The model is *instructed* to run
`npm run build`, gets `exitCode: 1` with `success: true`, and the harness records no error.

**Change:**

```ts
// build-tools.ts:369-379 — the execFile callback
(err, stdout, stderr) => {
  const code = err && typeof err === "object" && "code" in err ? (err as { code?: number | string }).code : 0;
  resolve({
    success: !err,                       // ← the ONLY correct check
    result: {
      stdout: stdout?.slice(-10000) || "",
      stderr: stderr?.slice(-10000) || "",
      exitCode: err ? (typeof code === "number" ? code : 1) : 0,
      timedOut: (err as { killed?: boolean } | null)?.killed === true,
    },
  });
}
```

`err` is non-null exactly when the process exited non-zero or was killed. `!err` is
correct; the `|| (err as any).killed === false` clause is what inverted it.

**Also fix the knock-on:** `executeToolSequence`'s "stop on error" is a no-op
(`build-tools.ts:581-583`) and the agent's error path keys on `!r.success`
(`build-agent.ts:257`) — with Fix 0.2, `state.errors` will finally contain real failures,
which the "fixing" phase (Fix 1.2) and oscillation detection (Fix 1.5) can act on.

**Verify:** in a scratch workspace, `run_command("npm run build")` in a project with a
broken build → `success: false`, error surface non-empty.

---

### Fix 0.3 — Implement `inspect_console` for real. It's a stub today.

**Finding (`build-tools.ts:418-436`):** returns `success:true, logs:[]` with a TODO.
Runtime errors physically cannot reach the model — so no amount of prompting about "no
console errors" ever works; there is no wire.

**Change:** implement using the BrowserPool that `toolScreenshot` already uses
(`build-tools.ts:388-413`). Acquire a slot, attach CDP `Runtime.consoleAPICalled` and
`Runtime.exceptionThrown` listeners, and buffer entries on the slot:

```ts
// build-tools.ts:418 — replace the stub body
const pool = getBrowserPool();
const slot = await pool.acquire(`console-${Date.now()}`);
try {
  const targetUrl = args.url || context.previewUrl || `http://127.0.0.1:${context.previewPort}`;
  if (!targetUrl) return { success: false, error: "No preview URL available" };
  const page = await slot.browser.getOrCreatePage(targetUrl);   // existing BrowserSlot API
  const entries = await page.captureConsoleLogs({                // new method on InfinityBrowser
    maxEntries, filter,                                            // filter: error|warning|log|all
  });
  return { success: true, result: { logs: entries } };
} finally { pool.release(slot); }
```

This requires a small method on `InfinityBrowser` (in `puppeteer-browser.ts`, where
`takeGridScreenshot` and `getInteractiveElements` live) that attaches the listeners when a
page is created and stores up to ~200 entries. The listeners already have a home — the
preview path, not the stub, is what's missing.

**Verify:** generate a page that throws in a click handler; `inspect_console` returns the
error as `logs[].level === "error"` with message + stack.

---

### Fix 0.4 — Stop the verification gate from reporting false green.

**Finding (`structured-tools.ts:292-332`):** `npx tsc` hits the registry shim in a
dep-less dir and `parseTypeScriptOutput` only matches `file(line,col): error TSxxxx` lines,
so non-matching output parses to `[]` → "passed". `npx vitest`, `npx eslint`, and
`npm run build` all run under `|| true`, so failures exit 0 and count as passing.
`parseBuildArtifacts` always returns `[]`.

**Changes (in `structured-tools.ts`):**

1. After Fix 0.1, remove `|| true` from the build/vitest/eslint commands and honor real
   exit codes:

```ts
const [tscResult, testResult, lintResult, buildResult] = await Promise.all([
  runCommand("npx tsc --noEmit --pretty false", workspacePath, 120_000),
  runCommand("npx vitest run --reporter=json", workspacePath, 120_000),
  runCommand("npx eslint -f json .", workspacePath, 60_000),
  runCommand("npm run build", workspacePath, 180_000),
]);
```

2. In `parseTypeScriptOutput` (`structured-tools.ts:220-290`): if the tsc process exited
   non-zero OR produced output that matched no `error TSxxxx` lines, return that raw output
   as a failure instead of `[]`:

```ts
if (raw.trim() && parsed.length === 0 && exitCode !== 0) {
  return [{ file: "(tsc)", line: 0, column: 0, code: "TSC-SHIM", message: raw.slice(0, 800), severity: "error" }];
}
```

3. Replace the `parseBuildArtifacts` stub (`structured-tools.ts:276-284`) with one that
   surfaces the build's stderr tail on `exitCode !== 0` as a `BuildArtifact` marked
   `failed`.

**Verify:** a project with a syntax error now yields `verifyWorkspace().ok === false` with
actionable `formatVerificationFeedback()` — and with Deps installed (Fix 0.1) the failure
is the *real* one.

---

## Stage 1 — Close the loop. Verification failure must reach a repair pass.

### Fix 1.1 — Replace the blind retry loop with a fixer pass in execute-plan.

**Finding (`build.ts:1131-1156`):** on `verifyWorkspace().ok === false`, the code sleeps
and re-runs the *same* check; `formatVerificationFeedback(verify)` is computed and never
fed to a model.

**Change:** keep the feedback, hand it to a repair pass that returns file edits, then
re-verify (up to `maxFixIterations = 3`): 

```ts
// build.ts:1133-1158, replacing the for-loop
if (hasIsolated(projectId)) {
  const verify = await verifyWorkspace(projectId, workspaceId);
  if (!verify.ok) {
    feedback = formatVerificationFeedback(verify);
    for (let round = 0; round < maxFixIterations && feedback; round++) {
      const fix = await runFixerPass(feedback, projectId, workspaceId, prompt); // existing fixer role
      if (!fix.ok) break;
      const recheck = await verifyWorkspace(projectId, workspaceId);
      feedback = recheck.ok ? undefined : formatVerificationFeedback(recheck);
    }
  }
}
```

`runFixerPass` is the orchestrator's existing `runFixer`/`buildFixerPrompt` path
(`build-orchestrator.ts:884-925`) — the pieces exist, they're just not called from the
route the UI uses. This converts the retry from a wait-loop into a repair-loop.

**Verify:** introduce a deliberate TS error in a step; the fixer rewrites the file and the
second verify passes.

---

### Fix 1.2 — Fix the one-way `fixing` phase trap and re-verify after `apply_fix`.

**Finding (`build-agent.ts:271-277`):** the phase switch has no `fixing` case, so once a
verification failure sets `phase = "fixing"`, the `phase === "verifying"` gate never
becomes true again — automatic verification runs at most once per agent run. And after
`tryLocalModelFix` applies patches, nothing re-runs verification
(`build-agent.ts:434-449`).

**Changes in `build-agent.ts`:**

1. Add a `fixing` transition — if the fixer makes edits, return to `verifying`:

```ts
} else if (phase === "fixing" && hasFileEdits) {
  newState.phase = "verifying";   // edits applied → re-verify (which can fail again → fixing)
}
```

2. After the `apply_fix` loop, re-run `verifyWorkspace` and push the result into
   `state.toolResults` (mirroring the existing verification-failure injection at
   `build-agent.ts:453-457`):

```ts
const postFix = await verifyWorkspace(context.projectId, context.workspaceId);
state.toolResults.push(postFix.ok
  ? { success: true, result: { type: "verification", ok: true } }
  : { success: false, error: formatVerificationFeedback(postFix), result: { type: "verification_failure" } });
```

**Verify:** force a failing verify, then a fix; confirm a second `verifyWorkspace` fires and
its result reaches the model's next user message.

---

### Fix 1.3 — Use the native tool-call channel instead of regexing the prose.

**Finding (`build-agent.ts:242` + `llm-adapter.ts:288-294`):** the adapter already
extracts `choice.message.tool_calls` into `completion.toolCalls`, and the loop discards it
by calling `parseToolCalls(completion.content)`.

**Change:**

```ts
// build-agent.ts:242
const toolCalls = completion.toolCalls?.length
  ? completion.toolCalls.map(tc => ({
      name: tc.function.name,
      arguments: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
      id: tc.id,
    }))
  : parseToolCalls(completion.content);   // fallback only for adapters without native calls
```

Pass `options.tools` and `toolChoice` (already present, `build-agent.ts:229-234`) and, where
the adapter supports it, feed tool results back as proper `tool`-role messages rather than
text — the conversation becomes `assistant(tool_call) → tool_result → assistant(...)`
instead of a text proxy. This is the mechanical fix for your point #7.

**Verify:** an instrumented run shows the tool loop using `completion.toolCalls` (no
regex), with correct call `id`s threaded to results.

---

### Fix 1.4 — Make `done` real: it must require verification, and it must not be an "unknown tool".

**Finding (`build-agent.ts:167-175, 484`):** `checkDone` matches `name === "done"` and
`success = state.phase === "done"` — so a red build that calls `done` returns success to
the caller, and `done` is not in `TOOL_DEFINITIONS` (it first executes as
"Unknown tool: done").

**Changes in `build-agent.ts`:**

1. Register `done` in `TOOL_DEFINITIONS` (`build-tools.ts:57-181`) so the round-trip isn't
   an error.
2. Make success conditional on real verification being **green or explicitly skipped**:

```ts
// build-agent.ts:484
const success = state.phase === "done"
  && (state.verificationState?.ok === true || state.verificationState?.skipped === true);
```

Where `verificationState` is populated by `verifyWorkspace`: `ok=true` when green,
`skipped=true` when there was nothing to run (no `package.json`, no tests configured) —
with the skip case logged honestly, not treated as a pass. Never `ok=true` from a
dep-less false-green (that disappears with Fix 0.1 + 0.4).

**Verify:** a build that fails verification and then calls `done` returns
`success: false` with the verification feedback surfaced.

---

### Fix 1.5 — Detect oscillation and no-progress. The loop currently runs blind to 20.

**Finding:** nothing tracks repeated edits, identical re-proposals, or "this fix didn't
help". The loop runs to `done` or `maxIterations` (20) regardless of whether it's spinning.

**Change in `build-agent.ts`:** maintain a rolling fingerprint of workspace state (hash of
each edited file's content, or of `(toolCall.name, JSON.stringify(args))`) across the last
6 iterations:

```ts
// in runAutonomousAgent's state
state.patterns = state.patterns ?? [];
state.patterns.push(fingerprint(state.toolCalls, state.toolResults));
if (state.patterns.length > 6) state.patterns.shift();

const repeats = state.patterns.filter(p => p === state.patterns[state.patterns.length - 1]).length - 1;
if (repeats >= 2 && !state.noProgressNotified) {
  state.noProgressNotified = true;
  state.errors.push("No progress detected — the last edit did not change the workspace. Stop repeating and pick a different approach.");
}
```

The model then sees this as a first-class error (it's in the `## ERRORS SO FAR` block) and
can change strategy — which is the "notice when its current hypothesis is wrong" habit from
your point #4, made environmental rather than instructed.

**Verify:** feed a loop a task it can't solve; confirm it stops repeating the same edit
after 2 identical proposals.

---

## Stage 2 — Ground the decisions in real content, not placeholders.

### Fix 2.1 — Store real file contents, not `[Modified by step-X]` placeholders.

**Finding (`build-orchestrator.ts:964`):** `modifiedFiles` stores
`"[Modified by step-" + stepId + ": " + summary + "]"` instead of content, so the reviewer
(`## MODIFIED FILE CONTENTS (after Coder changes)`) and cross-step coders read descriptions,
never code.

**Change:** capture the actual bytes the coder wrote:

```ts
// build-orchestrator.ts — applyCoderChanges
for (const change of handoff.changes) {
  const real = await readWorkspaceFile(change.file, workspaceId);   // or read from the agent result
  this.context.modifiedFiles.set(change.file, real ?? `[Missing: ${change.file}]`);
}
```

Where the agent already returns content, store that directly. Reviewer and
`gatherStepContext.relevantFiles` (`build-orchestrator.ts:931-959`) then operate on the code.

**Verify:** the reviewer prompt's modified-file fenced blocks contain real source.

---

### Fix 2.2 — Use the coder prompt that's built and thrown away.

**Finding (`build-orchestrator.ts:829-861`):** `buildCoderPrompt(step, stepContext)` is
computed and its return value never used — the step is flattened into a goal string for the
generic loop, dropping target files, acceptance criteria, and dependency file contents.

**Change:** pass the step context into the agent as real structure. Easiest correct version:
drive `runAgentForStep` with a user message assembled like the coder prompt (title,
description, target files, acceptance criteria, cross-step file contents), so the tool loop
starts with the step's contract instead of discovering it from prose.

**Verify:** two dependent steps — step B's prompt contains actual content of step A's output
file (see Fix 2.1).

---

### Fix 2.3 — Give the planner enough budget and real inputs.

**Finding:** planner gets `maxTokens: 900` (`build.ts:177`), only file *names* and
serialized summaries, no requirement clarifier, no stack selector. A 900-token output can't
hold title+summary+steps+files+risks for a real product.

**Changes in `build.ts:152-183`:**
- Raise `maxTokens` to ≥ 4000.
- Pass requirement-clarifier stage output (PRD) and tech-stack-selector result into the
  planner's user message — both already exist.
- Include content of the *existing* workspace files named in `existingFiles`, not just the
  names.

**Verify:** the plan JSON for the SaaS-landing-page example now contains concrete steps with
data flow (not just "build a header").

---

## Stage 3 — Wire the product path to the machinery that actually works.

### Fix 3.1 — The build button must reach the reviewer/fixer pipeline.

**Finding:** `grep -c "orchestrat" build-studio.tsx` → **0**. The user-facing Build Studio
uses the shallow `/build/plan` + `/build/execute-plan`; the orchestrator (real reviewer,
fixer, adversarial verify) is reachable only by raw HTTP.

**Change:** in `build-studio.tsx`'s `runAutoPipeline`/`continueBuild`
(`build-studio.tsx:1322-1330, 1494-1588`), after `execute-plan` completes, POST to
`/api/infinity/build/orchestrate` to run the review/fix loop instead of / in addition to the
8-pass iterate loop — or fold `runReviewer`+`runFixer` into the execute-plan route so the
UI doesn't change. The second option is less invasive: import `runReviewer`/`runFixer` and
call them per step in `build.ts` after verify.

**Verify:** after a normal build, a reviewer pass runs with real verification output in the
event log, and findings trigger fixer rounds.

---

### Fix 3.2 — Scaffold first; then inject the component corpus.

**Finding (Failure 3):** the framework adapters (`framework-generators/`,
`generateScaffold`), the 50+ component corpus (`ui-codegen.ts:82`, `SHADCN_COMPONENTS`),
and the 6 template starters are imported by **no build route**.

**Change:** in `/build/plan` or a new first step of `/build/execute-plan`, when the
workspace is empty, write the framework adapter's complete scaffold (pinned `package.json`,
`tsconfig`, `vite.config`, entry, Tailwind, `components.json`, `ui/button.tsx` — exactly
what `vite-react.ts:46-140` produces) before any generation. Then the coder prompt gets a
hard block:

> "DO NOT rewrite `package.json`, `tsconfig*`, `vite.config.*`. A runnable project skeleton
> already exists. Reuse the existing Tailwind design system and the UI library (shadcn:
> [list of SHADCN_COMPONENTS keys]). NEVER invent a dependency version — if it's not in
> `package.json`, add it through `run_command("npm install <pkg>@<version>")`."

This kills the "model invents APIs, files, or patterns that don't exist" problem at the
source — the ground truth is a real, pinned, runnable project.

**Verify:** a fresh build writes the scaffold first, and the generated app's `npm run build`
succeeds with the pinned versions.

---

## Stage 4 — Institute an acceptance bar.

### Fix 4.1 — Wire the done contract and implement the empty quality gates.

**Finding:** `runDoneContract`/`DoneContractEngine` (`build-done-contract.ts:1312`) has
zero callers; `runQualityGates` (`workflow-orchestrator.ts:1109-1131`) is empty
switch-case stubs.

**Change:**
1. In `runQualityGates`, implement gates backed by real tooling (build via `npm run build`,
   typecheck via `npx tsc --noEmit`, tests via `npx vitest run`, lint via `npx eslint -f
   json .`) — reusing `verifyWorkspace` where the worktree matches
   (`structured-tools.ts:292-332`).
2. Call `runDoneContract(projectId, workspaceId)` at the end of `/build/execute-plan`
   (after Fix 0.1 deps), and gate completion on it.
3. **Do NOT wire the fake gates.** `build-done-contract.ts`'s a11y/perf/SEO/visual/bundle
   checks return `passed:true` unconditionally. List them as `status: "not-enforced"` in
   the contract result until they have real backends, so "done" is an honest statement, not
   a green lie (this is the exact inverse of the current false-green verify).

**Verify:** completion requires build+typecheck+tests green; an app with a failing test
cannot reach "done".

---

## Stage 5 — Tell the model what "good" means, in the tokens it actually has.

### Fix 5.1 — Cut the identity boilerplate.

**Finding (`infinity-prompt.ts:20-50`):** ~500 tokens/iteration of "you are NOT ChatGPT"
roleplay, sent up to 20 iterations per agent run.

**Change:** shrink `INFINITY_IDENTITY` to two lines:

```ts
export const INFINITY_IDENTITY = `You are Infinity, an autonomous software engineering agent acting on a local workspace.`;
```

Return the saved budget to task context (more file contents, more tool results).

### Fix 5.2 — Add an explicit quality-standards block to planner and coder prompts.

**Finding (Failure 4):** the prompts tell the model to "typecheck" but never define what
shipped software is.

**Change:** add a shared `INFINITY_QUALITY_STANDARDS` block (in `infinity-prompt.ts`,
included for role `planner` and `coder`) covering: data modeling and server validation,
kosher error/empty/loading states, authentication and authorization boundaries, state
management, responsive + a11y behavior, tested behavior (write tests when the framework
supports it), and a hard rule — **no TODOs, no hardcoded demo data, no invented
dependencies.** The planner and coder already *have* a quality contract in their role
sections; this makes it substantive instead of procedural.

### Fix 5.3 — Give the loop a memory of its own reasoning (conversation continuity).

**Finding (`build-agent.ts:201-226`):** every iteration is a fresh 2-message call; the model
can't build on its own prior reasoning.

**Change:** grow the `messages` array instead of rebuilding it. Append the assistant
content + executed tool results as additional user/tool messages; when the message budget
is exceeded, compact the oldest turns (the orchestrator's `checkAndCompactContext` and
`context-compactor.ts` already implement this for Path B). Then the model reasons over its
own turns — "I already read file X, my edit produced Y" — which is the mechanism your point
#3 is missing: the big library becomes an *open* library, not five pages at a time.

**Verify:** mid-build, a tool result from iteration 3 is still quoted by the model at
iteration 9 without re-reading.

---

## Stage 6 — Behavior from the environment, not the prompt (tool strategy as policy).

### Fix 6.1 — Enforce the behavioral heuristics in the tool layer.

**Finding (your point #4):** the tools exist; the habits don't, because they're only
*described* in prose the model may ignore.

**Change in `build-tools.ts` `executeTool` (`build-tools.ts:197-267`):** make the harness
enforce the cheap, universal habits mechanically:
- **Read-before-write:** `edit_file` on an existing file returns an error unless a prior
  `read_file` (or a verification-file-listing) touched that path in the same agent run —
  first violation auto-injects the file's current content as a tool result instead of
  failing. (Environment provides the data; model keeps agency.)
- **Auto-diff after edit:** after every `edit_file`, append a `generateUnifiedDiff` output
  (`structured-tools.ts:82`) as a synthetic tool result so the model *sees* what it changed
  without requesting `git_diff` — the "re-read changed code" habit, made automatic.
- **Scoped tests first:** when a step declares target files, `run_command` defaults
  `cwd`/test-glob to the smallest relevant unit so verification starts where the change is.

This converts "inspect before touching / re-read changed code / test the smallest relevant
thing" from instructions into properties of the environment — your point #2's principle,
applied concretely.

### Fix 6.2 — Convergence over capability additions.

**Finding (your point #5):** 42 phases each added a *system*; none of them changed the
central loop. The fix is not a Phase 43 — it's folding the existing systems *into* the loop
(Fixes 0–5 already do exactly that: tools, verify, reviewer, done-contract, compaction,
corpus all become ingredients of one decision loop).

**Gate for future phases:** *"Does this feature feed the model's next decision with real
information, or does it exist?"* If the former — wire it. If the latter — don't build it.

---

## Validation sequence to run after the fixes

1. Fresh build of the SaaS-landing-page example → scaffold written, `npm install` runs,
   `npm run build` succeeds with pinned versions.
2. `verifyWorkspace` fails when I break a type and fails *truthfully* (no `|| true`).
3. A broken step produces a fixer pass (not a sleep), and the second verify reflects the
   repair.
4. `inspect_console` catches a thrown runtime error.
5. `done` is refused while unverified.
6. The model quotes its own earlier tool results mid-build (conversation continuity).
7. A red build can never render the green completion card.

Each line item maps to a specific fix above. When all seven behave, the "results aren't…
good" complaint is addressed at the level that causes it: not the model, not the prompt,
but an environment whose instruments tell the truth and whose loop is closed.