# Results-Quality Audit v2 — making Infinity's generated software actually good, in 50+ languages

> **Scope:** the code-generation pipeline and everything that determines what a user *gets* — scaffold quality, language coverage, system prompts, verification honesties, and the non-technical experience around them. Nothing about models and model names — excluded by the user.
> **Status:** research + plan. No product code was changed yet. This document replaces the v1 audit (the loop-gap campaign, Phases A–I, now complete and validated — see `PHASES.md`). It plans the next campaign: **breadth of language**, and with it, honest quality in each.
> **Method:** grounded in the shipped code (file:line referenced throughout), the published rankings of language popularity, and the practical realities of free-tier toolchains.

---

## Verdict

The v1 campaign proved that **Infinity Build works when the harness is honest**: the 5 live counters all pass (all fake-greens killed, verification runs real commands with real exit codes, "done" is an external verdict, error feedback loops, adaptive quality stop). The 5-app benchmark passed **104/104 checks** — real output, no human-coded fixes.

But there is a hard ceiling hidden in that result: **every one of those 104 checks was in JavaScript/TypeScript.** Infinity Build today supports exactly **7 JS/TS frameworks** (nextjs, astro, remix, vite-react, sveltekit, vue-nuxt, solidstart). A user who wants a Python API, a Rust CLI, a Go service, a Java backend, a C# app, a PHP site, a Ruby service, or a Swift program — the other 49 of the world's 50 most-used languages — has **no scaffold, no verification, no system prompts, no component corpus, and no benchmark**. The pipeline is honest, but only about one language family.

So the v2 answer to "is it actually good?" is:

1. **Breadth is the biggest quality lever now.** The harness is fixed; the *coverage* is the gap. Quality in one family is 7/50 of a multi-language product.
2. **The same proven machinery ports**: scaffold-now, verify-with-real-exit-codes, feed-failures-back, quality-green stop. Each new language gets the *same five guarantees* the JS/TS family already has — it does not get a lesser loop because it's not React.
3. **System prompts are a first-class deliverable per language**, with hard rules (never invent a pinned version, write real tests, reuse the scaffold, fix lint before done) tuned to that ecosystem's toolchain.
4. **Non-technical quality is a parallel track** — the user-facing surface (scaffold naming, error copy, README generation, "what did the build do" explainers, example-store) decides whether the loop *feels* good as much as the gate does.
5. **The bar is the same as v1, multiplied**: per language, the 5 live counters must pass and a 5-app benchmark (SaaS landing, Todo+persistence, Dashboard, Chat, Markdown editor) must pass its acceptance criteria — no human-coded fixes, `verify.mjs`-style gate per language.

This document is the full plan: the language matrix (§ 1), the architecture extensions in the shipped files (§ 2), the per-language quality spec including system prompts (§ 3), the non-technical improvements (§ 4), the phased roadmap (§ 5), and how we measure "actually good" (§ 6).

---

# § 1 — The 50-language matrix

## 1.1 Why these 50

"At least the 50 most-used" — sourced from the mainstream popularity and ecosystem rankings (TIOBE, GitHub Octoverse-style activity, package/registry download volumes, Stack Overflow survey language shares) as of the research date. **Tier 1** = languages with dominant ecosystems and real web/full-stack frameworks. **Tier 2** = strong, well-tooled ecosystems worth first-class support. **Tier 3** = maturing or domain-specialized — support via the shared pattern, lower scaffold depth. **Tier 4** = legacy/systems/niche — supported at "runnable hello + verify" depth. **Tier 5** = emerging — detected and documented, adapters land as the ecosystem matures.

Support depth has three levels (defined in § 2/§ 3):

| Depth | Meaning |
|-------|---------|
| **Full** | Scaffold library (2–3 real frameworks), component corpus, verification (typecheck / test / lint / build all real), system prompt, benchmark 5×5 |
| **Standard** | Scaffold (1 strong framework), verification, system prompt, benchmark via the shared harness |
| **Essential** | Detection, scaffold (hello-level), verify (compiler/test at minimum), system prompt |

## 1.2 The matrix

| # | Language | Tier | Depth now | Target depth | Primary ecosystems (adapter targets) |
|---|----------|------|-----------|--------------|--------------------------------------|
| 1 | JavaScript / TypeScript | 1 | **Full (7 frameworks)** | Full + 2 more (Qwik, Angular) | React, Vue, Svelte, Solid, Next, Astro, Remix, Qwik, Angular |
| 2 | Python | 1 | none | **Full** | FastAPI, Django, Flask, Streamlit |
| 3 | Java | 1 | none | **Full** | Spring Boot, Quarkus |
| 4 | C# / .NET | 1 | none | **Full** | ASP.NET Core, Blazor |
| 5 | Go | 1 | none | **Full** | Gin, Echo, Fiber |
| 6 | Rust | 1 | none | **Full** | Axum, Actix-web, Leptos (web UI) |
| 7 | PHP | 1 | none | **Full** | Laravel, Symfony |
| 8 | Ruby | 1 | none | **Full** | Rails (API), Sinatra |
| 9 | Swift | 1 | none | Standard | Vapor (server), SwiftUI (app) |
| 10 | Kotlin | 1 | none | **Full** | Ktor, Spring Boot (Kotlin), Compose Multiplatform |
| 11 | C++ | 2 | none | Standard | Crow, Drogon, Qt (app) |
| 12 | C | 2 | none | Essential | cURL-based CLI, libmicrohttpd |
| 13 | R | 2 | none | Essential | Plumber (API), Shiny (app) |
| 14 | Scala | 2 | none | Standard | http4s, Play (JVM base adapted) |
| 15 | Dart / Flutter | 2 | none | Standard | Flutter (app), Shelf (server) |
| 16 | Lua | 2 | none | Essential | Luvit, Lapis |
| 17 | Elixir | 2 | none | Standard | Phoenix, Phoenix LiveView |
| 18 | F# / .NET | 2 | none | Standard | Giraffe (ASP.NET Core base adapted) |
| 19 | Haskell | 2 | none | Essential | Warp + wai, yesod |
| 20 | Clojure | 2 | none | Essential | Ring/Compojure, reitit |
| 21 | OCaml | 3 | none | Essential | Dream |
| 22 | Nim | 3 | none | Essential | Jester |
| 23 | Zig | 3 | none | Essential | std.http, zzz |
| 24 | Crystal | 3 | none | Essential | Kemal, Lucky |
| 25 | Julia | 3 | none | Essential | Genie |
| 26 | V | 3 | none | Essential | vweb |
| 27 | Gleam | 3 | none | Essential | Wisp, Lustre |
| 28 | ReScript | 3 | none | Essential | ReScript + React (JS base adapted) |
| 29 | Elm | 3 | none | Essential | elm-pages (web) |
| 30 | PureScript | 3 | none | Essential | Halogen |
| 31 | Perl | 4 | none | Essential | Mojolicious, Dancer2 |
| 32 | Groovy | 4 | none | Essential | Grails, Micronaut (JVM base adapted) |
| 33 | Visual Basic (.NET) | 4 | none | Essential | ASP.NET Core (VB, .NET base adapted) |
| 34 | Assembly | 4 | none | Essential | None (bare system) |
| 35 | Fortran | 4 | none | Essential | None (compute-oriented) |
| 36 | COBOL | 4 | none | Essential | None (mainframe-oriented) |
| 37 | Ada | 4 | none | Essential | AWS (Ada Web Server) |
| 38 | Pascal/Delphi | 4 | none | Essential | Brook, fpWeb |
| 39 | Lisp (Common/Clojure-adjacent) | 4 | none | Essential | Hunchentoot, SBCL web |
| 40 | Prolog | 4 | none | Essential | SWI-Prolog HTTP |
| 41 | Ballerina | 5 | none | Essential* | Native service |
| 42 | Dark | 5 | none | Essential* | Darklang |
| 43 | Unison | 5 | none | Essential* | Unison services |
| 44 | Roc | 5 | none | Essential* | Roc web |
| 45 | Carbon | 5 | none | Essential* | Experimental |
| 46 | Vale | 5 | none | Essential* | Experimental |
| 47 | Austral | 5 | none | Essential* | Experimental |
| 48 | Koka | 5 | none | Essential* | Effectful web (from source) |
| 49 | Ante | 5 | none | Essential* | Experimental |
| 50 | Mojo | 5 | none | Essential* | AI/compute focus |

> **Depth honesty:** Tier 4/5 languages get *detection + a runnable scaffold + a verify command* — a user can build a real hello-level program and the loop verifies it. They do **not** get a pretend component corpus or a fake benchmark. A language without tests, linters, or a typechecker **reports those gates as `status:"not-enforced"`** exactly like the JS/TS `Done Contract` already does for SEO/perf — never as a forged green. That same honesty is what v1 won; § 2.2 keeps it for every language.
> \* Landing Tier 5 at "documented + detected" first (no scaffold) is acceptable if the toolchain isn't yet installable on free tier; the contract is: it must say so.

## 1.3 What "supported" means — the per-language bar (mirrors v1's 5 counters)

For **every** language at its target depth, before "supported" is written anywhere:

1. **Scaffold lands on disk** — a real runnable skeleton (pinned versions, one strong framework), created by `writeScaffoldWorkspace`, and the skeleton's own build passes *before it ships* (§ 2.1 — 6.4c extension).
2. **Real commands run with real exit codes** — typecheck / test / lint / build for that language, no `|| true`, no swallowing (§ 2.2).
3. **Failures come back as feedback** — a red verify is fed into the next agent turn; oscillation detection still fires (§ 2.3).
4. **`done` is an external verdict** — the done gate requires files written **and** a live green verify for that language's commands (§ 2.3).
5. **A 0-file step is never ok:true** — unchanged from v1 (§ 2.3).
6. **Benchmark** — for Full/Standard depth, the 5-app set (SaaS landing, Todo+persistence, Dashboard, Chat, Markdown editor) passes its acceptance criteria in `bench/` with a per-language `verify.mjs` gate, zero human-coded fixes (§ 6.2).

---

# § 2 — Architecture: how the shipped code extends to 50 languages

The whole v1 campaign lives in a handful of files. Every one has a clear, additive extension point. **Reuse over rearchitect**: we do not move to a generic orchestrator for everything; we make the existing per-framework machinery speak "language," and add shared base classes per language family so 7 React-adjacent adapters don't multiply into 70 bespoke ones.

## 2.1 Scaffold engine (`artifacts/api-server/src/lib/scaffold-engine.ts`)

**Today:** `writeScaffoldWorkspace(workspaceId, frameworkType)` writes the adapter's scaffold into an empty workspace, applies `SKELETON_GAP_FILES` (the tested fixes that make `npm run build` green: Home page, postcss, tailwind), merges `UI_CORPUS_DEPS` (78 pinned deps), copies `BASE_CORPUS` (24 shadcn components) + barrel, `git init` + commit, then fires `npm install` in the background.

**Extension — one function, per-language resolution:**

```
writeScaffoldWorkspace(workspaceId, request)   // request: { language, framework }
  language = resolveLanguage(request)            // § 2.4 detection
  familyAdapter = getLanguageFamilyAdapter(language)
  skeleton = familyAdapter.generateScaffold(request)   // real skeleton for that language
  apply gap files   → per-language GAP files (tested: the skeleton builds before it ships)
  merge deps        → per-language pinned dep map (pyproject/cargo/go.mod/maven/composer/…)
  copy corpus       → per-language component corpus (FastAPI routers, Axum handlers, …)
  git init + commit "Initial scaffold"
  fire install      → pip / cargo / go mod tidy / mvn / dotnet restore / composer / bundle
```

Concretely in the file:

- **`UI_CORPUS_DEPS` (lines 45–79)** — becomes a *map of maps*: `DEP_MAPS[language] = {…pinned deps…}`. Keep the JS/TS map as-is; add one per language family. Pinning stays **hard** (the corpus is tested, not assumed — § 6.4c).
- **`SKELETON_GAP_FILES` (lines 105–163)** — becomes `GAP_FILES[language]`. The rule that made JS/TS good: **the skeleton's own build must pass**, so the gap files are the *tested* versions that close real gaps (missing entry point, missing config the toolchain requires, missing `__init__`/`mod.rs`/`go.mod` wiring).
- **`BASE_CORPUS` (lines 166–171)** — becomes `CORPUS[language]`. For Python that's typed routers + models + templates; for Rust, typed handlers + `askama`/`maud` templates; for Go, handlers + `html/template`; that corpus is what `generate_component` assembles from, so the loop *assembles known-good parts* per language instead of writing them from scratch.
- **`scaffoldRulePrompt()` (lines 339–347)** — becomes `scaffoldRulePrompt(language)`: the same hard rules (don't rewrite the manifest, reuse the corpus, **never invent a version**, keep design tokens) restated for that ecosystem's manifest and lockfile (`pyproject.toml`+`uv.lock`, `Cargo.lock`, `go.sum`, `composer.lock`, `Gemfile.lock`).
- **`fireInstall` (line 292)** — becomes `fireInstallForLanguage(language)` with the right install command and the right env (virtualenv on the host for Python; `CARGO_HOME`/`GOPATH`/`M2_HOME` as needed).

## 2.2 Verification (`artifacts/api-server/src/lib/structured-tools.ts`)

**Today:** `verifyWorkspace` runs `npx tsc --noEmit`, `npx vitest run --reporter=json`, `npx eslint -f json .`, `npm run build` — real exit codes, no `|| true`, honest *skipped* states for missing tools, structured feedback via `formatVerificationFeedback`.

**Extension — dispatch by language:**

```
commandsFor(language) → RunSpec[]   // each: { label, cmd, parse, skipIfMissing, severity }
  python:  mypy --strict · pytest -q · ruff check . · build = install-dependent (uv/pip)
  rust:    cargo check · cargo test · cargo clippy -D warnings · cargo build
  go:      go vet ./... · go test ./... · gofmt -l . (lint) · go build ./...
  java:    mvn|gradle compile · test · checkstyle/spotbugs · package
  dotnet:  dotnet build --no-restore · dotnet test · dotnet format --verify-no-changes · dotnet build -c Release
  php:     php -l (syntax) · phpunit · phpstan analyse -lmax · composer install
  ruby:    ruby -c (syntax) · rspec|rails test · rubocop · bundle exec …
  swift:   swift build · swift test · swiftlint
```

The **honest-skip contract** is preserved and made generic: if a language has no linter, the lint gate reports `skipped` (not "passed", not forged green). If a language can't typecheck (Assembly, Prolog at Essential depth), the typecheck gate is `skipped`. New parse functions mirror the existing ones:

- `parseTypeScriptOutput` (200–230) family → `parseMypyOutput`, `parsePyrightOutput`, `parseRustcOutput`, `parseGolangciOutput`, `parseMavenOutput`, `parseDotnetOutput`, `parsePhpStanOutput`, `parseRubocopOutput`, `parseSwiftlintOutput` — each turns the tool's real text into the existing `{file, line, column, code, message, severity}` shape so **`formatVerificationFeedback` and everything downstream is already language-agnostic.**
- `parseBuildArtifacts` (292–315) is already path-based (`dist`, then the exit-code `failed:true` marker); generalizing just means the artifact dir per language (`target/`, `dist/`, `bin/`, `publish/`).

## 2.3 Loop & done gate (`artifacts/api-server/src/lib/build-agent.ts`, `build-done-contract.ts`)

**Nothing about the loop is JS-specific.** The growing conversation, native tool calls, verify-after-edit, the `## ERRORS SO FAR` block, oscillation fingerprints, adaptive `quality_green` stop, and `runDoneContract` inside `evaluateDoneGate` all operate on the *structured result shape* § 2.2 produces. The changes are:

1. **`verifyWorkspace` gets a language arg** — loop calls stay identical.
2. **System prompt** (`buildAgentSystemPrompt`) gains the per-language quality block (§ 3). It's a template; the language family chooses its rules.
3. **Tool schemas** (`build-tools.ts`) — `run_command` stays the universal escape; add *language-aware aliases* only where they cut failure (`run_test`, `run_lint`, `run_typecheck`) that resolve to the language's runner. The existing `run_command` circuit breakers still apply.
4. **Done contract** — the hard gates (build/typecheck/tests/lint) are already the enforced ones; per-language they resolve to that language's commands. The 9 `not-enforced` gates stay honest across languages (a sandbox can't measure a11y for a CLI Rust program either — and says so).

## 2.4 Detection (`artifacts/api-server/src/lib/framework-adapters.ts` + a new `detect-language.ts`)

**Today:** `detectFramework()` (610–867) sniffs JS/TS configs.

**New** `detect-language.ts` — a marker/language map, priority-ordered:

```
Cargo.toml          → rust
go.mod              → go
pyproject.toml      → python   (requirements.txt fallback)
pom.xml / build.gradle         → java (kotlin if *.kt)
*.csproj / *.sln               → csharp (fsharp if *.fsproj)
composer.json       → php      (wait: composer.json is ALSO CASM — order matters)
package.json        → detect framework first (JS/TS family, unchanged)
Gemfile, Swift, Package.swift, mix.exs, rebar.config, Rakefile, elm.json, …
```

Rules: **first matching marker wins**; `composer.json`/Cargo ambiguity resolved by explicit order + secondary cues (e.g. `src/*.rs` presence). Result feeds `writeScaffoldWorkspace` and `verifyWorkspace`. Unknown workspace → JS/TS default with a `detected:"none"` note surfaced honestly.

## 2.5 Language family base adapters (new `lib/language-families/`)

This is the reuse win. Instead of 50×16-method adapters, define ~10 **family bases** (⊥ existing `BaseFrameworkAdapter` patterns at 172–558) that share the package-manifest/build/test/lint/typecheck logic for their toolchain, with a per-framework subclass carrying only its real skeleton:

```
BaseJsTsAdapter        → 9 JS/TS frameworks (7 existing + Qwik, Angular)
BasePythonAdapter      → FastAPI, Django, Flask, Streamlit
BaseJvmAdapter         → Java (Spring, Quarkus), Kotlin (Ktor), Scala (http4s), Groovy
BaseDotNetAdapter      → C#, F#, VB
BaseGoAdapter          → Gin, Echo, Fiber
BaseRustAdapter        → Axum, Actix-web, Leptos
BasePhpAdapter         → Laravel, Symfony
BaseRubyAdapter        → Rails, Sinatra
BaseSwiftAdapter       → Vapor (server), SwiftUI (CLI/app)
BaseWebDynamicAdapter  → Elixir, Dart, and the Essential-depth tier (Dream, Kemal, Jester, Genie…)
```

Each family base owns: manifest template + **pinned-deps map**, gap files, corpus list, install command, and the runspec for § 2.2. The framework subclass owns: real folder structure + real config files + entry code. **The skeleton still builds before it ships, per framework.**

---

# § 3 — System prompts: the per-language quality spec

This is the paper that decides whether output *is* good. Every family carries a quality block injected into the agent system prompt, following the exact shape v1 proved (hard rules, reusing the scaffold, never inventing versions, write tests, fix lint before done, honor conventions). The block is written by humans and answerable by the toolchain — a rule that cannot be checked (e.g. "be elegant") is not a rule, it is noise.

## 3.0 Shared prelude (all languages) — the part that already works, restated

```
## Build rules (HARD, every language)
- The workspace already contains a runnable, pinned skeleton. Extend it; do not rewrite its
  manifest, lockfile, or build config unless the task genuinely requires it.
- Assemble from the shipped component corpus before writing UI/service code from scratch.
- NEVER invent a dependency version. If a dependency is missing, add it via the package
  manager with a real version (e.g. `pip install x==1.2.3` / `cargo add x@4.5` / `go get x@v1.2`).
- After every edit, run the project's verify commands; fix what they report before going on.
  A green build without real tests is a weak "done" — write tests where the toolchain supports it.
- If a gate reports skipped/not-enforced (that toolchain has no such tool), say so honestly;
  never fake a pass.
```

## 3.1 Python
```
## Python quality rules (HARD)
- Manifest: pyproject.toml (PEP 621). Pinned deps, PEP 508 markers where needed.
- Type safety: run `mypy --strict` (or pyright) — zero errors; annotate every public def.
- Tests: pytest; target > 80% coverage (`pytest --cov`); tests live under tests/.
- Lint: ruff (all rules) — zero findings before done.
- Style: PEP 8 + PEP 257; Google- or NumPy-style docstrings on public API.
- Data: prefer dataclasses / Pydantic models for any structured input; no bare dicts at boundaries.
- I/O: async/await (FastAPI) or explicit context managers; never do blocking I/O inside an event loop.
- Errors: exceptions with a clear message; typo'd namespaces and missing __init__.py are build failures.
- Framework caveats (per adapter): FastAPI — routers in app/routers/, pydantic schemas in app/schemas/;
  Django — apps, models, migrations committed; Flask — app factory pattern.
```

## 3.2 Rust
```
## Rust quality rules (HARD)
- Manifest: Cargo.toml with pinned deps; Cargo.lock is committed.
- Type safety: `cargo check` with `RUSTFLAGS=-D warnings` (or `#![deny(warnings)]`) — zero warnings.
- Tests: cargo test with #[test] and #[tokio::test]; unit tests beside the code, integration in tests/.
- Lint: cargo clippy -- -D warnings — zero findings before done.
- Style: rustfmt compliant (cargo fmt --check); document public items with /// (missing_docs is on).
- Errors: Result<T, E> everywhere; anyhow for app-level, thiserror for library types; avoid unwrap/panic in request paths.
- Concurrency: async/await with tokio; never block the runtime (no std::thread::sleep, no sync DB in async).
- Framework caveats: Axum — handlers in handlers/, extractors typed, state via AppState; Leptos — components in src/components/.
```

## 3.3 Go
```
## Go quality rules (HARD)
- Manifest: go.mod, pinned module versions; go.sum committed.
- Type safety: go vet ./... — zero findings; golangci-lint run (errcheck, govet, staticcheck on).
- Tests: *_test.go beside source; table-driven tests preferred; `go test -cover` target > 80%.
- Lint: gofmt -l and goimports clean; golangci-lint zero issues.
- Style: Effective Go; exported identifiers documented (golint/staticcheck is_doc compliance).
- Errors: every error handled or explicitly ignored with `_ =`; errcheck-clean; wrap errors with %w.
- Concurrency: context.Context threaded through; goroutines launched with clear ownership.
- Framework caveats: Gin — handlers in handlers/, routes in routes/, middlewares separate;
  Echo/Fiber same shape.
```

## 3.4 Java / Kotlin / JVM
```
## JVM quality rules (HARD)
- Manifest: Maven pom.xml (or Gradle build.gradle) with pinned versions (no SNAPSHOT drift).
- Type safety: `javac -Xlint:all` / Kotlin compiler warnings — zero errors; generics not raw types.
- Tests: JUnit (5) — target > 80% coverage; tests mirror production packages under src/test.
- Lint: Checkstyle (Google Java Style) or SpotBugs in the build; zero new findings.
- Style: Google Java Style; Kotlin — official Kotlin conventions + ktlint + detekt.
- Errors: exceptions with context; never swallow in catch; validation at boundaries (Bean Validation).
- Build: the compile step must be green before done (`mvn -q compile` / `mvn -q package -DskipTests` for structure).
- Framework caveats: Spring Boot — controllers/services/repos layers, constructor injection, @ConfigurationProperties;
  Quarkus — CDI beans, reactive where sensible; Ktor — routes/, plugins, content-negotiation.
```

## 3.5 .NET (C# / F# / VB)
```
## .NET quality rules (HARD)
- Manifest: <ProjectName>.csproj, SDK-style, pinned NuGet versions (PackageReference, no floating).
- Type safety: dotnet build --no-restore with warnings as errors in the analyzers (TreatWarningsAsErrors).
- Tests: xUnit (or NUnit) target > 80% coverage; tests in a separate *Tests project.
- Lint: dotnet format --verify-no-changes + built-in analyzers; zero findings.
- Style: Microsoft C# / .NET conventions; nullable enabled and zero nullability warnings.
- Errors: Result/exception at the right boundary; async/await all the way (no sync-over-async).
- Framework caveats: ASP.NET Core — controllers/ (or minimal APIs for small surfaces), DI wiring, EF Core migrations committed;
  Blazor — components in Components/, events through @onclick.
```

## 3.6 PHP
```
## PHP quality rules (HARD)
- Manifest: composer.json with pinned versions; composer.lock committed; PSR-4 autoloading.
- Type safety: phpstan analyse --level=8 (or psalm max) — zero errors; strict_types=1 on entry files.
- Tests: PHPUnit target > 80% coverage; tests in tests/, PSR-12.
- Lint: php -l syntax + phpcs (PSR-12) — zero findings.
- Style: PSR-12; typed properties and return types; declare(strict_types=1).
- Errors: exceptions with a thrown boundary; never swallow; HTTP layer returns status via the framework's
  response/exception model.
- Framework caveats: Laravel — controllers/services, Eloquent models, migrations committed, routes in routes/;
  Symfony — controllers/services, Doctrine entities + migrations.
```

## 3.7 Ruby
```
## Ruby quality rules (HARD)
- Manifest: Gemfile with pinned versions; Gemfile.lock committed.
- Type safety: type checking via steep or sorbet where the gem is present; otherwise `ruby -c` + strong tests.
- Tests: RSpec target > 80% coverage; specs in spec/ (rails: system specs for the happy path).
- Lint: rubocop (default + Layout) — zero findings.
- Style: Ruby Style Guide; frozen_string_literal magic comment; YARD doc on public methods.
- Errors: raise/ensure; never rescue-and-swallow; use the framework's error handling (Rails 5.2+ throw/catch is out).
- Framework caveats: Rails (API) — strong params, model validations, migrations committed;
  Sinatra — small surface, modular style.
```

## 3.8 Swift
```
## Swift quality rules (HARD)
- Manifest: Package.swift, pinned versions via Package.resolved committed.
- Type safety: swift build with warnings-as-errors — zero warnings.
- Tests: XCTest target > 80% coverage; tests in Tests/<Target>Tests.
- Lint: swiftlint (all rules) — zero findings.
- Style: Swift API Design Guidelines; docs on public API; no force-unwraps outside tests (prefer guard).
- Errors: do/try/catch with typed errors; Result where async.
- Framework caveats: Vapor — routes/controllers, Fluent models + migrations committed; SwiftUI — views/,
  @State/@Observable models, previews where supported.
```

## 3.9 Elixir
```
## Elixir quality rules (HARD)
- Manifest: mix.exs with pinned hex deps; mix.lock committed.
- Type safety: Dialyzer (mix dialyzer) — zero new warnings; @spec on public functions.
- Tests: ExUnit target > 80% coverage; tests in test/; async: true where safe.
- Lint: mix credo — zero findings.
- Style: official Elixir style; @moduledoc/@doc on public modules/functions; pipe with ;.
- Errors: with/else + tagged tuples; supervision tree owns lifecycle; never rescue-and-continue.
- Framework caveats: Phoenix — contexts/live or controllers, Ecto schemas + migrations committed,
  LiveView modules for realtime.
```

## 3.10 Essential-depth family (Elm, Gleam, Crystal, Nim, OCaml, Perl, … and Tier 4/5)
```
## <Language> quality rules (HARD, minimal but real)
- Manifest: <manifest> pinned; lockfile committed where the toolchain has one.
- Verify: run <typecheck-or-compile> and <test runner> before done — real exit codes.
- Lint: <linter> — zero findings; if none exists, the lint gate is honestly skipped.
- Style: <authoritative style guide reference> — follow it.
- Errors: follow the language's idiomatic error handling (no panics/aborts on request paths).
- Frame the scaffold: extend the shipped skeleton; never rewrite its manifest.
```

> **Anti-pattern to avoid (the v1 lesson):** a system prompt stuffed with un-checkable aesthetics. Every rule above maps to a real command the harness runs. If the rule can't be verified, it's either dropped or turned into a check.

---

# § 4 — Non-technical improvements (the "I'm not technical" track)

Quality is not only gates. These are the user-facing decisions that decide whether the loop *feels* good, listed in rough priority.

## 4.1 The scaffold is the impression. Name it like people do.
- Folders as `my-todo-app/`, services as `api/`, apps as `web/` — from the adapter, not from `"infinity-workspace-app"`.
- README generated per project by default: what it is, how to run (`npm run dev` / `uvicorn app.main:app` / `cargo run`), what it uses, how to test, where the code lives. Scaffold hands users a file they can read.
- A `.gitignore` and env template (`.env.example`) shipped in every scaffold — non-negotiable polish users notice immediately.
- Consistent folder conventions per family (Python `app/`, Rust `src/`+`tests/`, Go `cmd/`+`internal/`, Java `src/main/java/…`).

## 4.2 The loop explains itself (in the UI, not just logs).
- **Status line anyone can read:** "scaffold written → build green → 2 tests added → screenshot taken → all gates green → done" instead of a phase label.
- **Plain-language error cards:** when a gate fails, show "the build failed: <first real error, one line>" with the full log one click away — the agent already produces this text via `formatVerificationFeedback`; surface it.
- **A "what did it build" summary** at `done`: files created, commands run, gates checked (and which were honestly not-enforced), test count + coverage. This is the moment a non-technical user decides it "worked."

## 4.3 Choose tools the user already has.
- Detection-first: if `python3`/`cargo`/`go`/`dotnet`/`composer`/`ruby` isn't on the host, the scaffold still lands and the verify gates report honestly `skipped` with "install <tool> to enable checks" — never a silent fake green, never a wall of prerequisites at start.
- Install strategy per family in the 0-dollar style used for Chrome deps in v1: document + automated-setup where the host rules allow.

## 4.4 Example-store (a "make me X like Y" gallery).
- Convert validated `bench/out/*` wins into per-language starter prompts ("todo app with persistence", "landing page", "dashboard", "chat widget", "markdown editor") so new users start from a prompt known to pass the gate in that language.
- Store them as plain markdown with the acceptance criteria attached — they double as the benchmark corpus (§ 6).

## 4.5 Accessibility is said, not assumed.
- For web UI families, keep the JS/TS a11y checks (the audit locale's `inspect_accessibility` already exists) — port the same structural checks to any web-family (Leptos, Blazor, Tauri) and keep the honest `not-enforced` for non-web.

## 4.6 Language readiness is surfaced, not hidden.
- A `supported languages` screen: depth per language (Full/Standard/Essential/planned), what each level guarantees, and which toolchains must be present. Non-technical users see "Python — full · FastAPI" rather than a logo list.

## 4.7 Version discipline is a user-visible promise.
- "Pinned, because pinned is what builds" — when the scaffold installs, print the manifest + lockfile ("your deps are locked; the build you see is the build anyone gets"). This is the non-technical translation of the hard no-invented-versions rule.

---

# § 5 — Roadmap (phased, measurable at each step)

Each phase ends with the § 1.3 bar run against its languages (counters + `bench/` where depth allows). **No phase is "done" on a checkbox.**

| Phase | Scope | Deliverable that proves it |
|-------|-------|----------------------------|
| **0** | Foundations | `detect-language.ts`+ family-base skeleton (`BasePythonAdapter` first), scaffold routing by language, `fireInstallForLanguage`, runspec plumbing in `structured-tools.ts`. Gate: detection identifies 50 fixtures; a Python scatter-builds green. |
| **1** | Python **Full** | FastAPI + Django + Flask + Streamlit adapters, corpus, system prompt § 3.1, verify (mypy/pytest/ruff/build), README § 4.1. Gate: § 1.3 counters + 5×5 benchmark for Python. |
| **2** | Rust **Full** | Axum + Actix + Leptos, corpus (§ 3.2), cargo check/test/clippy/build. Gate: counters + 5×5 (web + CLI variants). |
| **3** | Go **Full** | Gin + Echo + Fiber, corpus (§ 3.3), go vet/test/gofmt/build. Gate: counters + 5×5. |
| **4** | JVM **Full** | Spring Boot + Quarkus (Java), Ktor + Spring Boot Kotlin, Scala/Groovy Standard via family base (§ 3.4), Maven/Gradle verify + parsers. Gate: counters + 5×5 (two languages at least). |
| **5** | .NET **Full** | ASP.NET Core + Blazor (C#), F# Standard, VB Essential via family base (§ 3.5). Gate: counters + 5×5 for C#. |
| **6** | PHP + Ruby **Full/Standard** | Laravel + Symfony; Rails + Sinatra; parsers + prompts (§ 3.6/3.7). Gate: counters + 5×5 for both. |
| **7** | Swift + Elixir Standard | Vapor + SwiftUI; Phoenix (LIVEVIEW). Gate: counters + 5×5 running per language. |
| **8** | Essentials wave (Tier 3) | Elm, Gleam, Crystal, Nim, OCaml, Julia, Zig, and the rest of § 1.2 rows 21–30 via `BaseWebDynamicAdapter` at § 3.10 depth. Gate: each scaffolds + verifies honestly. |
| **9** | Essentials wave (Tier 4/5) | Perl, Groovy, Pascal, Lisp, Prolog, Fortran, COBOL, Ada, Assembly, Ballerina, … — detection + runnable hello + verify; readiness screen § 4.6 shows depth. Gate: § 1.3 counters 1–5 per language. |
| **10** | Breadth polish | System-prompt audit (every rule checkable), benchmark for all Full/Standard languages (N×(5 apps, one gate)), example-store § 4.4 turn-on, README+branding pass § 4.1/4.2, Qwik + Angular landing for JS/TS Full. Gate: **every supported language ships at its stated depth with § 1.3 all-green.** |

Order reasoning: Python/Rust/Go/JVM/.NET first because they are Tier 1 and reuse the family-base win; PHP/Ruby/Swift/Elixir next; the "essential wave" then rides the shared base with one manifest template per family. Nothing is reworked a second time — the family base is the only new abstraction and it lands in Phase 0.

---

# § 6 — How we measure "actually good"

## 6.1 The § 1.3 counters, per language, in the existing harness shape
The five live counters from v1 (`deep-audit-driver.mjs` pattern) run per language and per depth. `bench/verify.mjs` gains a `--language` flag and a per-family runspec; `bench/driver.mjs local` takes language+app so the 5-app run is parameterized.

## 6.2 The benchmark, multiplied honestly
- Full/Standard languages: **5 apps × acceptance criteria**, judged by the language-appropriate gate (real DOM checks for web; real CLI/exit-code/API checks for services — a Python FastAPI "dashboard" is judged by request→response + data integrity, not a pixel screenshot).
- Essential languages: benchmark is "bare": scaffold runs, real command runs green, no fake skip. Do **not** claim a benchmark the toolchain can't support.
- Every result lands in `bench/REPORT.md` per language, with the exact `verify.mjs` gate attached so a human can re-run it.

## 6.3 What "done" now means
A user in any of the 50 languages describes a product in natural language and, without touching code, gets a working result — scaffolded, green per that language's real gates, with tests where the toolchain supports them, produced by the loop alone. Breadth across 50 languages at honest depth. The word "supported" is only ever used at the depth the language *actually* ships.

---

## Appendix A — file:line extension map (shipped code)

| File | Lines (today) | Extension |
|------|---------------|-----------|
| `lib/scaffold-engine.ts` | 45–79 deps · 105–163 gaps · 166–171 corpus · 187–282 write · 292 install · 339 prompt | per-language maps/install/prompt (§ 2.1) |
| `lib/framework-adapters.ts` | 18–26 schema · 30–64 config · 135–166 interface · 172–558 base · 610–867 detect | language field, family base classes, per-language detection (§ 2.4/2.5) |
| `lib/framework-generators/` | 7 adapters + registry | family bases + new framework subclasses |
| `lib/structured-tools.ts` | 200–290 parsers · 292–315 artifacts · 333–390 verify | per-language parse + dispatch (§ 2.2) |
| `lib/build-agent.ts` | ~140–200 system prompt · verify-after-edit · done gate · adaptive stop | per-language prompt block + runspec pass-through (§ 2.3/§ 3) |
| `lib/build-done-contract.ts` | hard gates enforced; 9 not-enforced | per-language hard gates; honest skips (§ 2.3) |
| `lib/build-tools.ts` | 15 tools · run_command circuit breakers | language-aware test/lint/typecheck aliases (optional) |
| NEW `lib/detect-language.ts` | — | marker → language (§ 2.4) |
| NEW `lib/language-families/` | — | 10 family base adapters + corpus dirs (§ 2.5) |
| `bench/verify.mjs` · `bench/driver.mjs` · `bench/REPORT.md` | JS/TS 5-app gate | `--language` parameterization, per-language report (§ 6) |

## Appendix B — Budget (`$0`, unchanged promise)
- Detection: pure Node `fs` checks — free.
- Verification: local toolchains (the same real-exit-code pattern already used for tsc/vitest); Python/Rust/Go/JVM/.NET compiler suites are free/open.
- Corpora: open-source component/typed-template libraries (shadcn ports, Askama/Maud, `html/template`, Razor, Thymeleaf, Blade are all free).
- Scaffolds: generated from open-source starters, pinned — never a paid service.
- Hosting/uploads/configs: zero-euro throughout. Same as v1: free OS deps, free toolchains, free libraries.

## Appendix C — openness / corrections
- **Depth honesty**: any language at any depth may report a gate `skipped` for a tool that doesn't exist; the readiness screen (§ 4.6) states the depth promised.
- **Ranking drift**: the top-50 list is a point-in-time snapshot. Adapters are data (`detect-language.ts` + `language-families/`), so promoting/demoting a language is metadata, not surgery.
- **The bar it must beat**: v1's 5-app, 104-check JS/TS pass. "Actually good" is that same evidence, in ≥50 languages, at honed depth.