---
name: QA browser runtime
description: Imported Puppeteer QA scripts may contain machine-specific browser paths and screenshot directories that do not work in Replit.
---

When running imported browser walkthroughs in Replit, verify the browser executable, runtime libraries, frontend artifact port, and screenshot output path before treating runner failures as application failures.

**Why:** Imported projects commonly preserve absolute paths from the original developer machine, while Replit artifact workflows may use a different port and browser runtime.

**How to apply:** Prefer a project-relative, configurable runner and distinguish test-harness startup failures from frontend/API defects in QA reports.

For interactive coverage, isolate each major UI surface in a fresh page and re-scan controls after every activation. Stateful overlays and data-backed rows can otherwise invalidate coordinates or create unbounded rediscovery loops.

**Why:** A single linear sweep through this app repeatedly invalidated stale targets and kept rediscovering conversation rows as navigation changed the DOM.

**How to apply:** Bound semantic control coverage per state, treat repeated data rows as one control type, and record blocked external/mutating requests separately from product failures.

For mobile chat screenshots, explicitly set the persisted app mode to `chat` before loading the page; the preview may otherwise reopen in saved voice mode and hide the chat composer.

**Why:** The app persists its mode in local storage, so a normal preview load can show a valid but unrelated full-screen voice surface during chat-layout QA.

**How to apply:** Use a fresh page, set the mode before reload, then open overlays such as the plus menu and capture the target viewport.

Responsive empty states should be checked at both width and height extremes; a fixed vertical transform can look correct on a modern phone while clipping the same content on an iPhone 4-sized viewport.

**Why:** The welcome/orb/suggestion stack and bottom composer share the available viewport, so height—not width alone—determines whether the composition remains balanced.

**How to apply:** Validate at least one 320×480 viewport, one modern phone viewport, and one extra-tall phone viewport before finalizing mobile positioning.

When backend routes change after a GitHub merge, restart the API workflow before diagnosing a frontend request as missing; an old running process can serve a stale route table even when the source already contains the route.

**Why:** The API Keys request returned 404 from the still-running pre-merge server while the merged source had the secrets route mounted.

**How to apply:** After pulls or backend changes, restart the API workflow and verify the exact endpoint directly before changing client loading logic.

For end-to-end claims, DOM activation counts are not completion evidence. Each
major surface and mutually exclusive action needs an isolated fresh state,
post-action assertion, and a status of PASS, FAIL, BLOCKED, NOT TESTED, or
SOURCE REVIEW ONLY.

**Why:** A broad infinity-ai sweep reported hundreds of successful activations even
though Settings persistence, provider flows, media workflows, and resulting
feature states were not conclusively completed.

**How to apply:** Never headline a QA report with click totals as a pass rate;
publish a per-workflow coverage matrix and keep harness failures separate from
application failures.