# PRODUCT GOALS — captured from the user's note (2026-09-12)

This file is the permanent home for the product's feature goals as expressed by Kasper in casual
language. It was created after a full 5-angle codebase exploration (build loop · frontend · API
surface · infra/DB · consumer cross-check) so every goal below is anchored to what actually exists
today. **Nothing here is scheduled yet** — this is capture, not a roadmap. When a goal is picked up,
it moves into `PHASES.md`.

Rules that apply to every goal:
- **$0 budget, forever.** No paid services, no free trials. Every goal is costed with a $0 path.
- **No provider/model names in the product's user-facing surface** — the product never tells the
  user which underlying inference provider it's running (see G07).

---

## PART 1 — THE RAW NOTE (verbatim, nothing lost)

> this is the note
>
> Also for the book creating system, they should run AI tests, rewrite, another ai test, rewrite,
> another ai test, rewrite until the ai test answers with a chance on AI less than 10%
>
> Also add custom 404 pages, clear error messages and clear fix for THE USER, not THE DEVELOPER, not
> some random code no one understands.
>
> There should also be a /admin url, the admins are like maybe like hardcoded or something or idk.
> In this /admin you see a dashboard with users this week, this day, this month, clicks etc. All
> kinds of data.
>
> Also add that the multiple agents (using different API keys) actually talk to each other. Every
> agent gets one role, for example: one is designer and asks "I do not have access to the chat
> history, what style UI did the user ask for" then the "Helper" which uses the local ai says "He
> asked for a modern iOS style UI, I suggest using the official iOS 27 assets" then the Icon maker
> says "Where should I get my icons from, generate them with AI or use Lucide or similar?" Helper
> then replies "Use Lucide for now and @Responder tell the user once we're done if he wants to
> change the lucide icons to something custom-made."
>
> It should all work together better. This is 1 thing that should work:
> You tell Infinity in the main chat "I want to start a company that makes 10k in the first month"
> then what it does is first: analyze what features he currently has acces to (for example: Build
> Mode, Promo mode etc.) then thinks if he needs an other tool to make this better: yes? He makes
> another tool using Build mode. No? He continues. Next: he makes a plan on what to do, something
> like this:
> Start a new "Conpany" project
> Do Deep Research for 30 minutes on how to make money with a website fast, what's currently
> trending, what websites make money fast etc.
> Then, start a new deep research session to make all the data he found from the previous deep
> research a clear website plan
> Then, he goes into build mode to build the website
> Then, he OR if the chrome extension is installed and set up, he opens a new tab with Vercel or
> Render to start hosting it. If it sends a captcha, the user gets a push notification on his phone
> to do the captcha, even if it didn't start on his phone. Then the human does the captcha the ai
> does the hosting. If the extension isn't installed he sends a push notification for the user to do
> it himself and give Infinity the data he needs (for example the URL)
> Then, he makes a promo for the website he just created.
> Then he does deep research to find out how you can do marketing the best.
>
> Something like this should work FULLY automatically. All the user should do is send the message
> and read the push notifications.
>
> Also add that the local ai acts as a watcher to see if the main ai runs into an error or is doing
> something he shouldn't. For example, if the main ai is making something illegal: he puts the ai to
> a stop and sends a push notification to the user on every device he's logged in to.
>
> Also add that he has acces to the list of models he's running on (without him revealing that to
> the user) for these type of large plans to know things like: does the model I'm running on have
> vision support, yes: I will do this request with him no: I will ask the user if I can switch my
> model.
>
> Add a completely brand new feature, @3D, it switches to a complete new mode where the agent can
> make 3D designs and show existing 3D designs as well. The user should then be able to interact
> with the 3D designs, zoom in, zoom out, click and delete certain parts of it etc.
>
> Character limit = max 22 if more than 22 turn into big
>
> Add like a "Train models" button to the API key menu which runs model training scripts on all
> models currently there.
>
> Make Infinity AI an MCP as well so you can connect to it from anywhere.
>
> Also add that Infinity Maps is not only able to show restaurants and other stuff nearby, it should
> also be able to generate routes for different goals like walking, biking, hiking, etc. Make sure
> it also has the option to start the route using Infinity Maps itself but the user could also click
> "Google Maps" or "Apple Maps" which automatically inputs enough checkpoints to the route so it's
> the exact same route as infinity maps created!
>
> Also give Infinity the ability to ask_user in both Chat mode and Build mode which shows a pop-up
> with multiple options or like a text box where you can put in a custom answer. These ask_user
> pop-ups can be max. 5 pages and max 5 options per page.
>
> Also add a "Omni" effort level which goes FULL POWER, takes long but is incredibly powerful. This
> mode should be insane, people should be absolutely shocked by how good it is. This mode is not for
> token efficiency, this is for full, pure POWER.
>
> Also add that Infinity Video, a way infinity can completely edit videos all on his own. It
> automatically routes to a vision model to check his own video.
>
> Infinity Build should be able to fully interact with the website he just made, there should also
> be a tool he should be able to call in which he does a full walkthrough of the entire websites,
> takes screenshot of every frame, notes down the results of every button he clicks and creates a
> file with the results and images as proof.
>
> Infinity should also have the ability to see your location using the browser allow thing, using
> this, without any tags you can ask questions like these in voice mode and chat mode "I wanna go to
> the McDonalds, do I go left or right" it then uses openstreetmap and your live location to answer.
>
> Also add that in a "Company" or "Website" project you can make your own Font, you only have to
> design a few letters and Infinity makes the rest in the exact same style, decideds the spacing,
> thin, italic, bold, extra bold etc. And eventually outputs a simple .otf file. Also, when you
> start a Build session inside a "Website" or "Conpany" project, it automatically uses your font (in
> part of the website)

---

## PART 2 — STRUCTURED GOALS

Grouped into families. Each goal: the ask, what exists today (verified `file:line` anchors),
what's net-new, the $0 path, and honest notes.

### FAMILY A — WRITING & CONTENT

#### G01 · Book creator: human-sounding verification loop
- **The ask:** In the book-creating system, each draft must pass an "is this AI-written?" test;
  if the AI-probability is ≥ 10%, rewrite and re-test, looping until it scores under 10%.
- **Today:** Book planning + PDF jobs exist (`routes/infinity/book.ts`, book-engine lib). There is
  no detection gate and no rewrite loop.
- **Build:** a local, $0 AI-ness scorer (perplexity + burstiness heuristics — classic detection
  signals that run offline), wired as a gate in the book pipeline: Draft → Detect → Rewrite while
  p(AI) ≥ 10%, then ship.
- **Cost:** $0 (local heuristic scorer; no external detection API).
- **Note:** honesty — heuristic scorers are approximate; "under 10%" is a target, not a guarantee.

### FAMILY B — THE USER EXPERIENCE

#### G02 · Custom 404 pages + errors written for THE USER
- **The ask:** Custom 404 pages; every error message and suggested fix must be in plain human
  language for the user — never developer jargon, never a raw stack trace.
- **Today:** A single global `ErrorBoundary` exists in the frontend; errors surface mostly as
  developer text. 404s are default. The build loop has an errors-first block (`## ERRORS SO FAR`)
  but it speaks to the agent, not the user; `PLAN.md` verdicts are terse.
- **Build:** a friendly `NotFoundPage` route; a user-facing error layer (title + what happened +
  "here's how you fix it") sitting in front of `ErrorBoundary`; translate engine/verify failures
  into user-language cards on build completion (same failure, human words).
- **Cost:** $0 (pure frontend + presentational mapping of existing errors).

#### G09 · Character cap: max 22, then "big"
- **The ask (verbatim):** "Character limit = max 22 if more than 22 turn into big."
- **Today:** No such rule exists anywhere.
- **Build:** A shared text-display rule — anything that hits a 22-char limit renders its overflow
  in a "big" display style. **AMBIGUOUS:** the user did not say where this rule lives (titles?
  the font designer glyph limits? status text?). Needs one clarifying question before building.
- **Cost:** $0.

#### G13 · `ask_user` pop-up in Chat AND Build
- **The ask:** The agent gains an `ask_user` tool in both Chat and Build that shows a pop-up with
  option buttons or a free-text box. Constraints: max 5 pages, max 5 options per page.
- **Today:** Nothing like it exists. Note the deliberate tension: in an earlier decision the user
  rejected *auto-asked* mid-build questions ("no one wants mid-build questions… fall asleep, wake
  up done") — the plan-to-repo workflow locks all questions up-front. So `ask_user` must be an
  *explicit tool the agent may call*, gated so the sleep test is never broken.
- **Build:** a `build-tools.ts` `ask_user` tool + a `chat.ts` variant; frontend modal component
  (paginated options / text box); server round-trip so the agent blocks until the user answers.
  Chat mode can use it freely; Build mode needs an interactivity flag (`interactive: true`) before
  the agent is allowed to call it.
- **Cost:** $0.

#### G17 · Location-aware navigation (browser permission + OpenStreetMap)
- **The ask:** Infinity asks for browser-geolocation permission; then in chat OR voice mode you can
  ask "I wanna go to the McDonalds, do I go left or right" and it answers using OpenStreetMap + your
  live location. No tags needed.
- **Today:** Maps exist (`routes/infinity/maps.ts`: `/search`, `/geocode`, `/detect`, OSM-backed;
  a maps widget renders nearby places). Voice exists (speak/transcribe routes; chat is live).
  Geolocation is never requested.
- **Build:** frontend `navigator.geolocation` hook (with the permission prompt = "the browser allow
  thing"), a routing call (OSRM public API, $0) from live coords to the POI, and step rendering that
  can answer "left or right" from the first turn instructions. Wired into both chat and voice.
- **Cost:** $0 (OSM + OSRM are free; permission is client-side).

### FAMILY C — AUTONOMY & THE BIG ONE-SHOT FLOW

#### G05 · The fully-automatic "start a company" flow (the flagship goal)
- **The ask:** From one chat message — "I want to start a company that makes 10k in the first
  month" — Infinity autonomously: (1) inventories the features the user already has (Build Mode,
  Promo Mode, …), (2) decides if it needs a new tool and, if yes, builds it with Build Mode,
  (3) makes a plan, (4) runs 30 min of deep research (how to make money fast, what's trending),
  (5) distills that into a clear website plan via a second deep-research session, (6) builds the
  website in Build Mode, (7) deploys it — via the Chrome extension opening Vercel/Render, and if a
  captcha appears, pushes the user a notification on their phone to solve it while Infinity
  continues the hosting; if no extension, notifies the user to do it manually and hand back the URL,
  (8) makes a promo for the site, (9) deep-researches the best marketing. **The user's only job is
  to read push notifications.**
- **Today (all building blocks exist):** tasks + workflow routes (`/workflow/*`: create/status/
  approve/clarify/generate-prd), deep-research (`deep-research-v2.ts`), build (`/build/plan` +
  `/build/execute-plan`, plan-to-repo), promo (`promo.ts`), push notifications (`push.ts`, web-push
  VAPID), the extension bridge (`/api/infinity/extension/*` + WebSocket), project types
  (`project-types.ts`).
- **Build:** a top-level "campaign" orchestrator that *chains* the existing blocks (a new
  multi-hour counterpart to the build loop), plus: **real deployment honesty** (unified-deploy
  currently fakes success — see the API map; the flow must either actually deploy or honestly
  surface a manual step + push), push-driven human-in-the-loop for captcha/URL handoff, and a
  `project_activity`-style progress feed the user can watch.
- **Cost:** $0 (public hosting CLIs $0 where a lone developer has them; deep research runs on the
  user's own free keys).
- **Note:** this is the single biggest goal in the note and the natural continuation of the
  "sleep test" axis — it is autonomy-first by design.

#### G06 · Local-AI watchdog (supervisor of the main agent)
- **The ask:** A local model continuously watches the main agent. If the main agent errors or does
  something it shouldn't (e.g. starts making something illegal), the watcher hard-stops it and
  pushes a notification to every device the user is logged into.
- **Today:** Local adapter exists (`lib/adapters/local-adapter.ts`, Ollama). Push exists
  (`push.ts`, `pushSubscriptions` table). There is no supervisor anywhere.
- **Build:** a sidecar "watcher" per build: a local model samples the agent's transcript + tool
  calls on a tick, scores for errors / policy violations; on a trip, kill the agent loop and
  notify all push subscriptions. All-device fan-out = iterate the user's sessions→subscriptions.
- **Cost:** $0 (local model already available locally; a small local model is the watcher).
- **Note:** honesty — a small local model's judgment is a heuristic. It's a watchdog (catches
  obvious misbehavior) not a policy oracle.

#### G07 · Model-capability introspection (internal only)
- **The ask:** For large plans, the orchestrator can see the list of models it's running on and
  their capabilities (e.g. "does my current model have vision?") — **without ever revealing that
  to the user** — and decide: vision? yes → proceed, no → ask the user's permission to switch.
- **Today:** `model-router.ts` has per-model configs, but its decisions are **disconnected** from
  the running build (`routeAndExecute` reads the env singleton, ignores the router's computed
  model). Capability info is never surfaced to the agent.
- **Build:** a capability query (vision / long-context / tool-calling) per key+model, exposed as an
  internal context block to the orchestrator (never in user-facing text), and a consent flow when a
  capability is missing. This also unplugs `routeAndExecute` so router decisions finally apply.
- **Cost:** $0.

#### G14 · "Omni" effort level — full power
- **The ask:** A new effort tier that goes FULL POWER. Takes long, costs tokens, but the result is
  "insane" — people should be shocked. Explicitly *not* for token efficiency; pure power.
- **Today:** The loop has iteration caps (`maxIterations`, stall detection, adaptive quality-green
  stop) and the workflow has fixed settings. There is no "insane" tier.
- **Build:** an Omni profile that raises/renders caps, enables multiple full research passes, a
  critique-and-revise phase per deliverable, several from-scratch attempts kept and best-picked,
  and delayed compaction. Since keys are free, cost = time + quota, not money — which lets Omni be
  genuinely extreme.
- **Cost:** $0 money (longer runs on existing free keys; heaviest on the *user's owned* local /
  NIM keys).

### FAMILY D — AGENTS WORKING TOGETHER

#### G04 · Role-based multi-agent crew that actually talks
- **The ask:** The multiple agents (each with its own API key) must genuinely converse. Each agent
  has one role. Example from the user: the **Designer** asks the **Helper** (which runs on the
  *local* model) "what style UI did the user ask for?"; the Helper answers from chat history;
  the **Icon maker** asks where to source icons; the Helper answers and @-mentions the
  **Responder** to tell the user about the Lucide/custom choice. It should all work together.
- **Today:** A multi-agent orchestrator exists (`lib/build-orchestrator.ts`: planner→coder→
  reviewer→fixer) and is used, but it does NOT converse: the reviewer's verdict is derived from a
  single boolean, it writes fake zero token usage, and all agents share the same key pool rather
  than each having its own key.
- **Build:** an agent message bus — a shared conversation log any agent can post to and read;
  roles map to rule blocks; each role may pin a specific key/endpoint (e.g. Helper → local;
  Designer → a vision-capable key); @mentions route messages to the named role; the local Helper
  indexes the chat history + working context so role-isolated agents can ask it questions.
- **Cost:** $0 (the Helper already runs on the local model; other roles use the user's own keys).

### FAMILY E — BUILD & THE BROWSER

#### G16 · Full-site interaction + walkthrough-with-proof tool
- **The ask:** Build can fully interact with the website it made, and can call a tool that does a
  complete walkthrough of the entire site — screenshot every frame, note the result of every button
  click, and write a file with the results + images as proof.
- **Today:** Most primitives exist: a per-build browser pool (navigate / action / state /
  screenshot / inspect elements), `capturePreviewDomForIterate`, an existing `/build/walkthrough`,
  `inspect_console`/`inspect_dom` tools, and the bench's `verify.mjs` (screenshot + interaction
  hooks + responsive gates). But there is no systematic click-everything walkthrough that emits a
  proof artifact.
- **Build:** a new tool (e.g. `walkthrough` in `build-tools.ts` / `TOOL_DEFINITIONS`) that enumerates
  interactive elements, clicks each through the browser pool, screenshots every state, logs each
  result, and writes `walkthrough-report.md` + inlined screenshots into the workspace — the
  provable acceptance run. This is the natural machine version of the human bench runner.
  Also close the real gap: desktop preview is currently fed `projectId` not rendered components, so
  "fully interact" starts by fixing the live-preview wiring.
- **Cost:** $0 (Puppeteer + Chrome already in the project).

#### G18 · Custom font maker in Company/Website projects
- **The ask:** Inside a "Company" or "Website" project you can design just a few letters; Infinity
  generates the complete font in the same style — decides spacing, thin/italic/bold/extra-bold
  weights — and outputs a simple `.otf`. When a Build session runs inside a Website/Company
  project, it automatically uses your font in the site.
- **Today:** Project types exist (`project-types.ts`; Website/Company kinds). Fonts don't exist
  anywhere.
- **Build:** a font-design UI (draw a glyph set), a generator that extrapolates style into the
  remaining glyphs + weights + kerning, and `.otf` export via an open-source $0 toolchain
  (fonttools/fontmake); in Website/Company builds, inject the font into the generated site (CSS
  `@font-face` + theme).
- **Cost:** $0 (open-source font toolchain; glyph inference is a local algorithm).
- **Note:** honesty — "exact same style" extrapolated from a few letters is the genuinely hard
  part; the first version will be sound-but-stylistically-faithful-to-a-degree, not a font-design
  masterpiece.

### FAMILY F — NEW MODES & CREATIVE

#### G08 · @3D — a complete 3D mode
- **The ask:** A brand-new `@3D` mode. The agent can create 3D designs and show existing ones, and
  the user interacts with them — zoom in/out, click and delete parts, etc.
- **Today:** Nothing 3D exists in the product.
- **Build:** a new mode surface (like the build/preview split but for scenes): a web scene viewer
  (orbit controls: zoom/rotate/click-select/delete) built on an open-source $0 engine, plus agent
  tooling that generates/modifies scene code and renders it — the natural loop analogue of the web
  build loop.
- **Cost:** $0 (a permissively-licensed JS engine + local scene assets).

#### G15 · Infinity Video — autonomous video creation & editing
- **The ask:** Infinity can fully edit or create videos on its own, and it automatically routes to
  a vision-capable model to review its own output.
- **Today:** ffmpeg is already bundled (file-converter uses it for audio/video), and screenshots/
  frames can reach the agent via the vision channel — but there is no video pipeline.
- **Build:** a video tool layer (cut/trim/merge/captions/text via ffmpeg, $0), a "frames→vision
  model→fix→re-render" self-check loop (which depends on G07 capability introspection to pick a
  vision-capable key), and a video surface.
- **Cost:** $0.

#### G12 · Infinity Maps: routes + exact handoff to Google/Apple Maps
- **The ask:** Maps should not just show nearby places — it should generate routes for walking,
  biking, hiking, etc. You can start the route in Infinity Maps itself, or click "Google Maps" /
  "Apple Maps" buttons that auto-input *enough checkpoints* that the route is the exact same one
  Infinity Maps created.
- **Today:** Maps does nearby-search only (`/search`, `/geocode`, `/detect`; OSM). No routing.
- **Build:** a routing engine (OSRM public API, $0) producing step geometry for
  walking/cycling/hiking; render the polyline in the maps widget; "Open in Google/Apple Maps"
  buttons that deeplink with the route's checkpoint sequence (Google Maps supports up to ~9
  waypoints, Apple Maps deeplink is different — the checkpoint count must adapt so the shared route
  matches).
- **Cost:** $0.
- **Note:** the "exact same route" guarantee has hard limits from the target apps (waypoint caps /
  deeplink URL schemes) — those constraints must be surfaced honestly in the UI.

### FAMILY G — PLATFORM & SERVICES

#### G03 · `/admin` dashboard (hardcoded admins)
- **The ask:** A `/admin` URL. Admins can be hardcoded (or similar). The admin dashboard shows
  users this week / this day / this month, clicks, and all kinds of data.
- **Today:** Auth has scopes (`requireScope`, account JSONB `scopes`) but no admin role, no /admin
  route, no dashboard. Analytics exists but is path-mismatched/broken (the frontend calls
  `/analytics/aggregates` while the backend serves it under `/ui-builder/analytics`).
- **Build:** an `admin` scope + `/admin` frontend route behind it (admin seed = a hardcoded account
  check or role flag); a dashboard over `accounts` (createdAt → this day/week/month cohorts),
  `sessions`, `project_activity`, login events, and a fixed analytics path.
- **Cost:** $0 (SQL over existing tables).
- **Note:** "clicks" data needs a real event source — today no click/usage table exists; the
  dashboard's click metrics will be as honest as the recording pipeline underneath them.

#### G10 · "Train models" in the API-key menu
- **The ask:** The API-key menu gets a "Train models" button that runs model-training scripts on
  all models currently there.
- **Today:** The key menu exists (`/api/infinity/llm-keys`, `LLMKeysTab`), plus a local-model panel
  (`/api/infinity/local-model`: explain/fix/status/pull).
- **Build:** a "Train models" action per key/endpoint that runs available training scripts.
- **Note:** **honesty flag** — remote keyed models (the vast majority of the pool) cannot be
  retrained by anyone holding an API key; "all models currently there" therefore effectively means
  the locally-hosted ones. The button should be wired to the local side and honestly state what's
  trainable vs not.
- **Cost:** $0 (local training scripts).

#### G11 · Infinity as an MCP you can connect to from anywhere
- **The ask:** Make Infinity an MCP server so you can connect to it from any external tool/app.
- **Today:** The server already has a huge, real tool catalog (`tool-registry.ts`, ~47 tools;
  `registerAllTools()` at boot) and API-key auth — a natural MCP surface. No MCP protocol layer
  exists.
- **Build:** an MCP server endpoint (open-source $0 stack) exposing the existing tool registry over
  the configured API-key auth; since clients connect "from anywhere," the server must be reachable
  (the current deploy story is run-it-yourself — that's the limiting factor, not the MCP code).
- **Cost:** $0 (open-source MCP SDK; auth reuses existing API keys).

---
_End of capture. Raw note preserved verbatim in Part 1; structured goals in Part 2. When you start
building these, they graduate one by one into `PHASES.md`._