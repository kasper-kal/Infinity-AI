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