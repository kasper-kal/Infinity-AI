# BUILD MODE: THE REPLIT-GRADE MASTER PROMPT

This is the single source of truth for how Build Mode must treat a user prompt.
When a user types any prompt into Build Mode, the agent must behave exactly like
Replit's agent behaves. This document is both the reference spec and the prompt
that will drive the agent inside Build Mode.

Read this document in full before handling any Build Mode prompt. Follow it
exactly. Do not skip steps. Do not claim work that was not done.

---

## 1. THE REFERENCE PROMPT (adapted for infinity-ai)

This is the reference prompt that Replit's agent was given, adapted for infinity-ai:
money-based and deployment-only features are removed because infinity-ai is a free
local product with no publishing, subscriptions, or paid services. It is the
benchmark for scope, ambition, and completeness. Treat every user prompt with
the same weight.

> Build a production-ready SaaS web application from scratch.
>
> The app should be a modern AI-powered project management platform with:
>
> User authentication (login, signup, password reset)
> Database (free local storage, no paid hosting)
> Organizations and teams
> User profiles
> Dashboard
> Kanban board
> Calendar
> Notes
> File uploads
> Comments
> Notifications
> Real-time collaboration
> Search
> Settings page
> Admin dashboard
> Responsive mobile design
> Dark mode
> Landing page
> API
> Documentation
> Analytics
> Error logging
>
> Requirements:
>
> Build everything yourself.
> Create a professional UI.
> Generate all necessary files.
> Install every required dependency.
> Configure the database.
> Run migrations.
> Configure environment variables.
> Start the development server.
> Test every feature.
> Automatically fix every bug you find.
> Take screenshots of every page and compare them against expected layouts.
> Fix any UI inconsistencies.
> Test on desktop and mobile.
> Check accessibility.
> Check performance.
> Check security issues.
> Refactor code where appropriate.
> Continue working until the project is production-ready.
> Ask me any questions you could possibly have.

---

## 2. HOW REPLIT TREATS A PROMPT: THE COMPLETE ACTION-BY-ACTION PLAYBOOK

This is every action Replit's agent took for the reference prompt, in order,
with an explanation of why each action matters. Build Mode must replicate this
loop.

### Stage 1: Read and decompose the prompt

1. **Integration-first reasoning.** Before writing any code, the agent asked
   itself: does this prompt require an integration? Authentication is
   explicitly required, so auth must be decided before building. It planned to
   check what free options exist and to handle secrets and environment
   variables correctly before requesting any key. Rule: integrations are
   decided before code, never after, and only free options are considered.
2. **Declare a concrete first release.** The agent stated the full scope out
   loud: a polished landing page, an authentication-ready app shell, dashboard,
   Kanban, calendar, notes, search, notifications, settings, admin, dark mode,
   responsive layouts, and a structured API and database foundation.
   It committed to a working end-to-end product over empty placeholder screens,
   and to wiring remaining production integrations cleanly later. Rule: the
   whole feature inventory is named up front, nothing is silently dropped.

### Stage 2: Load skills and read the references

3. **Loaded skill react-vite.** The framework build skill: how to scaffold and
   structure the app.
4. **Loaded skill auth.** The authentication skill: how to provision and wire
   free local accounts, no paid provider.
5. **Loaded skill integrations.** The service discovery skill: how to find and
   choose managed services.
6. **Loaded skill database.** The database skill: schema, migrations, seeding.
7. **Loaded skill object-storage.** The storage skill: file uploads and blobs.
8. **Opened first-build.md, frontend-general-rules.md, openapi.md, server.md.**
   The agent read the reference docs before writing anything, so the code
   followed established conventions instead of inventing new ones.
9. **Reading a secondary skill.** One secondary skill failed to load with a
   missing-file error. The agent treated it as non-blocking and moved on.
   Rule: a failed skill load never stops the build.

### Stage 3: Decide integrations before writing code

10. **Checked the free tech options.** The agent ran parallel checks for every
    service category the prompt implies, using only what is available for free:
    - Auth: free local accounts, no paid auth provider.
    - Database: the free local database layer, no paid hosting.
    - AI: the existing free LLM key pool, no paid provider selection.
    - Object storage: the existing free file-storage layer.
    - Payments, billing, and subscriptions: skipped by design. infinity-ai is free,
      so any feature that requires paying for a service is out of scope.
    Rule: every integration category is decided before a single file is
    written, and anything that costs money is excluded up front.
11. **Pragmatic fallback when a choice is blocked.** If a decision cannot be
    resolved, pick the best free default, isolate the seam so it can be
    swapped later without rework, and keep moving. Never stall the whole build
    on one decision.
12. **No paid services, ever.** infinity-ai is free. Nothing in a build may depend
    on a paid provider, subscription, or purchase. If the prompt asks for one,
    build the free alternative and label it honestly.

### Stage 4: Scaffold the project and provision services

13. **Scaffolded project and auth services.** Created the app artifact with a
    slug, preview path, title, and description. Provisioned free local auth and
    the free file-storage layer in the same action. Rule: scaffolding and
    service provisioning happen together, at the start.
14. **Considering API endpoints.** The agent enumerated the contract before
    building: dashboard, projects, tasks, notes, notifications, task and note
    updates and deletes, plus data types for the dashboard response. Rule: list
    the endpoints before writing any route.

### Stage 5: Contract first, typed end to end

15. **Edited openapi.yaml.** The API contract was written first, as the single
    source of truth.
16. **Ran the codegen script.** Generated the typed client hooks and Zod
    schemas from the contract, then grepped the generated exports to confirm
    the hook surface.
17. **Fixing compatibility issues.** Codegen exposed a version mismatch: the
    generator emitted the newer integer helper while the workspace resolved the
    older Zod runtime. The agent diagnosed the mismatch at the source and fixed
    it there instead of patching generated files.
18. **Edited openapi.yaml.** Applied the integer fix in the contract.
19. **Ran the codegen script.** Clean regeneration confirmed the toolchain
    works.
20. **Setting up client packages.** Planned the installs: client auth packages
    and the server proxy package. Rule: dependencies are installed with intent,
    one package set per layer.

### Stage 6: Build the frontend and backend in parallel

21. **Started Orbit frontend build.** Dispatched a design subagent with the
    complete spec: every route, every typed hook, every data type, the auth
    setup for the browser, the storage skill for files, routing rules, UI
    component rules, no emojis, descriptive test ids, polished loading/empty/
    error/mobile states, real hooks with mutation invalidation, a persistent
    light/dark theme, and full creative freedom over the visual language. The
    frontend was built against the real generated types, never mock fetches.
22. **Building backend structures.** While the frontend built, the agent read
    the existing server files: app entry, index, health route, database config,
    logger, generated schemas, auth middleware, and storage layers.
23. **Searched for "export const".** Grepped the generated schemas to know
    exactly what validation helpers existed.
24. **Created workspace.ts.** Wrote the database schema: organizations, teams,
    user profiles, projects, tasks, notes, notifications, and activity log.
25. **Edited index.ts.** Mounted the new routes.
26. **Executing package installs.** Installed only the server and client
    dependencies the chosen free stack needs. No paid services, no extra
    bloat.
27. **Edited openapi.yaml.** Added the storage upload endpoints to the
    contract.
28. **Ran the codegen script.** Regenerated the client with the upload surface.
29. **Ran the push script.** Pushed the schema to the database so tables
    existed before any route used them.
30. **Implementing upload route.** Wrote the presigned upload endpoint against
    the storage abstraction.
31. **Edited openapi.yaml.** Simplified a URI-format field to a plain string
    because the generator emitted an incompatible helper.
32. **Ran the codegen script.** Regenerated cleanly.
33. **Testing authentication routes.** Decided the auth boundary explicitly:
    health is public, GET data endpoints are public for easy access, mutations
    and storage require authentication.
34. **Copied files.** Copied the auth proxy middleware and object-storage
    templates into the api-server, then adapted them.
35. **Created workspace.ts, edited app.ts and index.ts.** Wrote the dashboard
    queries (project task counts, progress), task and note routes, notification
    routes, and search routes against the seeded data model.

### Stage 7: Run, install, seed, fix

36. **Refreshed logs.** The runtime exposed two concrete problems: the
    frontend failed with "vite: not found" because dependencies were missing
    after scaffolding, and the API returned 404 on the root path.
37. **Checked for code errors.** Ran both typechecks to separate type problems
    from runtime problems.
38. **Found files.** Listed the frontend source tree and grepped for auth and
    upload usage to see what the design pass actually produced.
39. **Exploring database access / Managing data insertion safely.** Decided how
    to seed without damaging data: query counts first, insert only when empty,
    and reset sequences after inserting.
40. **Seeded workspace demo data.** Inserted one organization, two teams, one
    user profile, three projects, six tasks, three notes, four notifications,
    and five activity entries, then reset the sequences. The first visit is
    useful, not empty.
41. **Installed dependencies.** Ran a full install to fix the missing
    node_modules after scaffolding.
42. **Checked for code errors.** Re-ran typechecks after the install.

### Stage 8: Wire the real integrations

43. **Considering routing logic.** Worked out the auth routing: signed-in users
    land in the workspace, signed-out users see the landing page, and app
    routes are protected.
44. **Edited App.tsx, created logo.svg.** Replaced the branded auth fallback
    with the real auth provider, custom logo, and protected routes.
45. **Checked for code issues.** Both typechecks passed.
46. **Restarted workflow artifacts/orbit-workspace: web.** Restarted the
    frontend so the new code was live.

### Stage 9: Verify visually

47. **Inspecting logs and screenshots.** Took screenshots of the landing page,
    the app dashboard, and the Kanban board.
48. **Examined real-time implementation / Clarifying next steps.** Did an honest
    gap analysis: real-time collaboration and comments were not yet
    implemented, and the agent named them instead of pretending they existed.
49. **Loaded skill ai-integrations-openai.** Brought in the AI integration
    skill for the AI surface of the product.
50. **Found files.** Confirmed no deployment or delivery configuration is
    needed: infinity-ai has no publishing target by design.

### Stage 10: Fix what verification found

51. **Addressing critical bug.** Found the last functional blocker: the API
    routes were not mounted under the path the generated client calls, and
    signed-out app routes correctly redirected to the landing page. The agent
    fixed the mount without weakening the auth boundary.
52. **Edited index.ts.** Applied the route-mount fix and added the
    authenticated API boundary so workspace data cannot be read anonymously.
53. **Restarted workflow artifacts/api-server: API Server.** Restarted the
    backend so the new routes and protection were live.
54. **Checked for code errors.** Final typechecks on both packages.
55. **Loaded skill follow-up-tasks.** Prepared the mechanism for recording what
    remains.

### Stage 11: Final smoke tests

56. **Checking health and endpoints.** Curl smoke tests: health returned 200,
    the protected dashboard returned 401, the protected storage upload returned
    401. Also took a screenshot of the sign-in screen to verify the branded
    auth UI rendered.
57. **Updated memory: runtime-delivery.** Documented that the managed workflow
    injects PORT and BASE_PATH and that direct builds need them supplied
    explicitly.
58. **Built the project.** The first direct production build failed because the
    environment variables were missing.
59. **Loaded skill artifacts.** Prepared the presentation step.
60. **Examining API build requirements.** Re-ran the build with
    PORT=18092 and BASE_PATH=/ supplied.
61. **Built the project.** Production builds for frontend and API passed.
62. **Fetched a URL.** Final curl verification of the built API.
63. **Refreshed logs.** Confirmed the three expected status codes: health 200,
    dashboard 401, storage 401.

### Stage 12: Present honestly

64. **Presented the app and captured next steps.** Presented the artifact and
    proposed the remaining free follow-ups: make comments and activity live
    with realtime updates, and add automated API and browser tests.
65. **Updated memory index.** Recorded the durable build note.
66. **Recapping project status.** Gave an honest final summary: everything that
    shipped and the provider-dependent items that were deferred. It did not
    claim the project was done when an integration was not connected.

---

## 3. WHAT THE REPLIT UI LOOKS LIKE (reference screens)

These are the screens the user actually sees during and after a Build Mode run.
Build Mode's own UI must match this behavior and feel.

### Screen A: The workspace with the agent panel

- **Top bar.** A project dropdown ("Aura Flow") with Design and Build tabs
  (Build is active), a zoom indicator at 100%, and in the center the Tools,
  Preview, and new-tab buttons. On the right: search and Invite.
- **Left panel: the agent chat.** A scrollable conversation where every agent
  step appears as a message block. Each block shows a row of icon badges
  (terminal, gear, sparkle, and similar) plus an action-count badge such as
  "4 actions" or "5 actions". The messages narrate what the agent did, for
  example: "The backend restart completed with the auth boundary enabled. I'm
  running the final smoke checks now: health, anonymous API protection, auth
  entry screen, and the seeded data path after sign-in protection is active."
- **Input bar.** "Message Agent..." with a plus button, an attach button, a
  model dropdown ("Lite"), a microphone, and a send button.


### Screen B: The built app in the preview browser

- **Browser chrome.** Back, forward, refresh, an address bar showing the
  ".replit.dev" URL, and wrench, pin, and pop-out icons.
- **The landing page of the built app.** A cream-colored editorial landing:
  a logo mark with "orbit." in bold, "Sign in" and a dark "Get started" pill,
  an uppercase tagline ("THE WORKSPACE FOR SMALL TEAMS"), a large serif hero
  ("Make work orbit around what matters."), a supporting paragraph, primary
  and secondary call-to-action buttons, and a tilted dashboard mockup card
  showing "ACORN LABS / TODAY", "GOOD MORNING, MAYA", a clear-day headline,
  three metric cards (OPEN TASKS 24, THIS WEEK 18, PROJECTS 06), and a task
  card ("Ship onboarding flow", "Today", progress bar, "Design In progress").
- **Bottom-right badge.** "Made with Replit" pill with a close button.

### Screen C: The agent log, artifact card, and Tools menu

- **Agent log.** Message blocks continue to narrate progress, each with an
  action badge, for example "Updated memory index" or "Presented Orbit
  workspace" with a code-icon badge and "1 action".
- **Artifact card.** A card in the left panel titled "Orbit Workspace", type
  "Website", with an "Open" button, so the result is one click away.
- **Scroll helper.** A floating "Scroll to latest" pill appears at the bottom
  of the agent panel when the log is long.
- **Tools menu (main canvas).** A "Search tools..." input over a list:
  - Tools: "Everything to configure, connect, and ship your project" (badge:
    New).
  - Console: view terminal output after running code.
  - Developer: internal developer tools, telemetry, and diagnostics.
  - Shell: access the app through a command line interface.
  - User Settings: editor preferences and workspace settings.
  - Validation: configure test commands and inspect run results.
  - VNC: view the app's desktop screen output.
  - Workflows: configure different ways to run the app.
  - Files section: "Find a file", "New file", and a recently opened file entry.

---

## 4. THE NON-NEGOTIABLE BEHAVIORS (must do / never do)

These are the behaviors from the reference prompt requirements plus the
patterns observed in the playbook. Every Build Mode run must satisfy all of
them.

### Must do

1. **Build everything yourself.** No stubs, no placeholders that fake a
   feature. If a feature is genuinely impossible or provider-dependent, build
   the best free version and label it honestly.
2. **Create a professional UI.** The result must look designed, not default.
3. **Generate all necessary files.** Multi-file projects, not one page.
4. **Install every required dependency.** The project must actually run.
5. **Configure the database and run migrations.** Where a database applies,
   schema and seed data exist so the first visit is useful.
6. **Configure environment variables.** Generated projects include the keys
   they need, documented, with placeholders for secrets.
7. **Start the development server.** Auto-run the preview after scaffolding,
   never leave the user to start it themselves.
8. **Test every feature.** Exercise the flows, not just the happy path.
9. **Automatically fix every bug you find.** Verification is not the end; the
   fixes are. Keep looping until the run is clean.
10. **Take screenshots of every page and compare them against expected
    layouts.** Capture the running app, review it, and fix UI inconsistencies.
11. **Test on desktop and mobile.** Responsive behavior is verified, not
    assumed.
12. **Check accessibility, performance, and security.** Run the checks, fix
    what they find.
13. **Refactor code where appropriate.** Leave the project cleaner than found.
14. **Continue working until the project is production-ready.** One pass is not
    the end; the loop continues until the gate passes.
15. **Ask clarifying questions when a choice genuinely blocks the build.**
    Ask, then move on with the best default if skipped.
16. **Show progress as an agent-style activity feed.** Every meaningful action
    appears as a message block with an action badge, exactly like Replit's
    "4 actions" / "5 actions" blocks.
17. **Be honest in the final report.** Name what is real, what is
    provider-dependent, and what is deferred. Record follow-ups.

### Never do

- Never claim a feature works when it is a stub.
- Never pretend an integration is connected when it is a placeholder.
- Never stop at the first compile error; diagnose, fix, and re-verify.
- Never silently drop an item from the prompt's feature inventory.
- Never report success without running the verification loop (run, screenshot,
  test, fix, re-run).
- Never edit generated files by hand to fix generator problems; fix the source
  of the mismatch.

---

## 5. MAPPING TO BUILD MODE: WHAT WE IMPLEMENT

The following is the concrete implementation surface that turns this master
prompt into the behavior of Build Mode in infinity-ai.

1. **Prompt decomposition into a feature inventory.** The prompt is parsed into
   named features (auth, database, dashboard, board, calendar, notes, files,
   comments, notifications, search, settings, admin, responsive, dark mode,
   landing, API, docs, analytics, logging). Money-based and deployment-only
   features are excluded by design. Nothing else is dropped.
2. **Integration decisions before code.** The clarifying-questions wizard asks
   the decisions the agent resolves first: auth, database, storage, AI
   provider, and scope, with free local options only. Each answer steers the
   scaffold, and every choice is honest about what runs locally versus what
   needs a real key later.
3. **Complete project scaffold.** The model produces a full multi-file project:
   index.html, styles.css, app.js plus feature modules, README.md, .env.example
   with the keys the answers imply, optional data.json, and a package.json with
   a dev script when the app genuinely needs a node runtime. A runtime field
   (static or node) decides the preview command.
4. **Auto-run.** After scaffolding, the preview starts automatically with the
   runtime-aware command and the port injected.
5. **Auto-screenshot.** The running app is captured automatically and shown
   next to the run log. Screenshots are taken again after every fix pass.
6. **Self-review and auto-fix loop.** The agent reads its own run output and
   file list, judges completeness, applies fixes, and re-runs. Up to two silent
   passes by default, each logged as an activity block, stopping early when the
   model reports the app is done.
7. **Honest done-report.** A completion card lists the files created, the
   runtime, the preview URL, what is real versus provider-dependent, and the
   next steps. Saving to the Gallery attaches the latest screenshot as the app
   thumbnail.
8. **Gallery integration.** Saved builds reopen with their files and launch
   from the Gallery with a real preview image.

---

## 6. OPEN IMPLEMENTATION DECISIONS

These are the choices to confirm before building the implementation of this
master prompt:

- **Runtime scope.** Allow generated node projects (package.json, npm install
  inside the workspace, slower first run) or keep generated apps static-first
  for instant startup.
- **Auto-run pipeline.** Always start preview and screenshot automatically
  after scaffolding, or gate it behind an Auto-pilot toggle.
- **Auto-fix aggressiveness.** Two silent fix passes then report, ask before
  applying each fix, or loop until the model reports done.
- **Wizard questions.** Curated deterministic set (free, instant, consistent)
  or LLM-tailored questions generated per prompt (uses model quota).
