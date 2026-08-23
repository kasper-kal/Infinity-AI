import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const url = process.env.infinity-ai_QA_URL || "http://localhost:21662/";
const outDir = process.env.infinity-ai_QA_OUT || "./qa-report/crucial-flows";
mkdirSync(outDir, { recursive: true });
const chromiumPath =
  process.env.CHROMIUM_PATH ||
  execFileSync("sh", ["-lc", "command -v chromium"], { encoding: "utf8" }).trim();

const browser = await puppeteer.launch({
  headless: true,
  executablePath: chromiumPath,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--mute-audio",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});

const results = [];
const errors = [];
let screenshotCount = 0;
let blockedRequests = 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hook(page, flow) {
  page.setRequestInterception(true);
  page.on("request", (request) => {
    const requestUrl = request.url();
    const method = request.method();
    const blocked =
      requestUrl.includes("/api/infinity-ai/chat") ||
      requestUrl.includes("/api/infinity-ai/transcribe") ||
      requestUrl.includes("/api/infinity-ai/speak") ||
      requestUrl.includes("/api/infinity-ai/generate-image") ||
      requestUrl.includes("/api/infinity-ai/verify") ||
      requestUrl.includes("/api/infinity-ai/research") ||
      requestUrl.includes("/api/infinity-ai/browse") ||
      requestUrl.includes("/api/infinity-ai/gmail/auth") ||
      requestUrl.includes("/api/infinity-ai/spotify/auth") ||
      (requestUrl.includes("/api/") && ["POST", "PUT", "PATCH", "DELETE"].includes(method));
    if (blocked) {
      blockedRequests += 1;
      request.abort().catch(() => {});
    } else {
      request.continue().catch(() => {});
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`[${flow}] console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`[${flow}] pageerror: ${error.message}`));
  page.on("dialog", async (dialog) => {
    results.push({ flow, kind: "browser-dialog", type: dialog.type(), message: dialog.message() });
    await dialog.dismiss().catch(() => {});
  });
  page.on("filechooser", async (chooser) => {
    results.push({ flow, kind: "filechooser", activated: true, completion: "blocked-no-file" });
    await chooser.cancel().catch(() => {});
  });
  page.on("popup", async (popup) => {
    results.push({ flow, kind: "popup", url: popup.url(), activated: true, completion: "blocked-external" });
    await popup.close().catch(() => {});
  });
}

async function shot(page, flow, label) {
  screenshotCount += 1;
  const filename = `${String(screenshotCount).padStart(3, "0")}-${flow}-${label}`
    .replace(/[^a-z0-9._-]+/gi, "-")
    .slice(0, 120) + ".png";
  await page.screenshot({ path: `${outDir}/${filename}`, fullPage: false }).catch(() => {});
}

async function fresh(flow) {
  const page = await browser.newPage();
  hook(page, flow);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(1500);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(1200);
  return page;
}

async function visibleElements(page, selector = "button,[role='button'],input,textarea,[role='tab']") {
  return page.evaluate((selector) => [...document.querySelectorAll(selector)].map((element, index) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      index,
      tag: element.tagName,
      text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim(),
      aria: element.getAttribute("aria-label") || "",
      title: element.getAttribute("title") || "",
      placeholder: element.getAttribute("placeholder") || "",
      type: element.getAttribute("type") || "",
      visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
      disabled: Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true",
    };
  }).filter((item) => item.visible));
}

async function clickText(page, flow, text, label = text) {
  const outcome = await page.evaluate((needle) => {
    const elements = [...document.querySelectorAll("button,[role='button'],[role='tab']")];
    const element = elements.find((candidate) => {
      const content = (candidate.innerText || candidate.textContent || "").replace(/\s+/g, " ").trim();
      const aria = candidate.getAttribute("aria-label") || "";
      const title = candidate.getAttribute("title") || "";
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
        !candidate.disabled && (content === needle || content.includes(needle) || aria === needle || title === needle);
    });
    if (!element) return { ok: false, reason: "not-found" };
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    return { ok: true };
  }, text);
  await wait(350);
  await shot(page, flow, label);
  results.push({ flow, kind: "control", target: text, ...outcome });
  return outcome.ok;
}

async function clickSelector(page, flow, selector, label) {
  const outcome = await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element) return { ok: false, reason: "not-found" };
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    return { ok: true };
  }, selector);
  await wait(350);
  await shot(page, flow, label);
  results.push({ flow, kind: "selector", target: selector, ...outcome });
  return outcome.ok;
}

async function typeInto(page, selector, value, flow, label) {
  const outcome = await page.evaluate(({ selector, value }) => {
    const element = document.querySelector(selector);
    if (!element) return { ok: false, reason: "not-found" };
    element.focus();
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return { ok: false, reason: "no-value-setter" };
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }, { selector, value });
  await wait(200);
  await shot(page, flow, label);
  results.push({ flow, kind: "input", target: selector, ...outcome });
  return outcome.ok;
}

async function enterChat(page, flow) {
  await clickText(page, flow, "Back to chat", "enter-chat");
}

async function openSettings(page, flow) {
  await enterChat(page, flow);
  await clickText(page, flow, "Menu", "open-menu");
  await clickText(page, flow, "Settings", "open-settings");
}

const settingsViews = [
  ["Personalization", "personalization"],
  ["Memory", "memory"],
  ["Language", "language"],
  ["Email", "gmail"],
  ["Spotify", "spotify"],
  ["Accent color", "accent"],
  ["Web search & data", "app"],
  ["LLM keys", "llm"],
  ["About", "about"],
];

for (const [label, view] of settingsViews) {
  const flow = `settings-${view}`;
  const page = await fresh(flow);
  await openSettings(page, flow);
  await clickText(page, flow, label, `open-${view}`);
  const controls = await visibleElements(page);
  results.push({ flow, kind: "inventory", view, controls });

  if (view === "personalization") {
    await typeInto(page, "textarea", "QA-only profile text", flow, "profile-form");
    await clickText(page, flow, "Custom", "custom-personality");
    await typeInto(page, "textarea", "QA-only custom prompt", flow, "custom-prompt");
    await clickText(page, flow, "Settings", "return-home");
  } else if (view === "language") {
    await clickText(page, flow, "Nederlands", "select-dutch");
    await clickText(page, flow, "English", "select-english");
  } else if (view === "accent") {
    await clickText(page, flow, "Purple", "select-purple");
    await clickText(page, flow, "Blue", "select-blue");
  } else if (view === "app") {
    await clickText(page, flow, "Web search", "toggle-web-search");
    await typeInto(page, "input[placeholder*='weather'], input[placeholder*='Weather']", "London", flow, "weather-input");
    await clickText(page, flow, "Add feed", "add-calendar-feed");
    await clickText(page, flow, "Preview system prompt", "preview-system-prompt");
  } else if (view === "gmail") {
    await clickText(page, flow, "Connect Gmail", "connect-gmail");
  } else if (view === "spotify") {
    await clickText(page, flow, "Connect Spotify", "connect-spotify");
  } else if (view === "llm") {
    await clickText(page, flow, "Add key", "add-llm-key-empty");
  } else if (view === "memory") {
    results.push({ flow, kind: "completion", completion: "empty-state-observed; no memory record available for edit/delete" });
  }
  await clickText(page, flow, "Close", "close-settings");
  await page.close();
}

async function runSurface(flow, setup, actions = []) {
  const page = await fresh(flow);
  await setup(page);
  await shot(page, flow, "surface");
  for (const action of actions) await action(page);
  await page.close();
}

await runSurface("plus-menu", enterChat, [
  (page) => clickSelector(page, "plus-menu", "#plus-menu-button", "open-plus-menu"),
  (page) => clickText(page, "plus-menu", "Attach file", "attach-file"),
  (page) => clickSelector(page, "plus-menu", "#plus-menu-button", "reopen-plus-menu"),
  (page) => clickText(page, "plus-menu", "Camera", "plus-camera"),
  (page) => clickSelector(page, "plus-menu", "#plus-menu-button", "reopen-plus-menu-2"),
  (page) => clickText(page, "plus-menu", "New Gem", "plus-gem"),
]);

await runSurface("gem-dialog", async (page) => {
  await enterChat(page, "gem-dialog");
  await clickSelector(page, "gem-dialog", "#plus-menu-button", "open-plus-menu");
  await clickText(page, "gem-dialog", "New Gem", "open-gem-dialog");
  await typeInto(page, "input", "QA Gem", "gem-dialog", "gem-name");
  await typeInto(page, "textarea", "A QA-only test prompt", "gem-dialog", "gem-prompt");
  await shot(page, "gem-dialog", "filled-form");
}, [
  (page) => clickText(page, "gem-dialog", "Create", "create-gem-blocked"),
  (page) => clickText(page, "gem-dialog", "Close", "close-gem"),
]);

await runSurface("research-panel", async (page) => {
  await enterChat(page, "research-panel");
  await page.keyboard.down("Control"); await page.keyboard.press("k"); await page.keyboard.up("Control");
  await wait(300);
  await clickText(page, "research-panel", "Deep Research", "open-research");
  await typeInto(page, "textarea", "QA-only research request", "research-panel", "research-goal");
  await clickText(page, "research-panel", "Deep", "research-depth-deep");
  await clickText(page, "research-panel", "Normal", "research-mode-normal");
  await clickText(page, "research-panel", "Start research", "research-start");
  await clickText(page, "research-panel", "Cancel", "research-cancel-confirmation");
  await clickText(page, "research-panel", "Close research", "close-research");
}, []);

await runSurface("data-lab", async (page) => {
  await enterChat(page, "data-lab");
  await page.keyboard.down("Control"); await page.keyboard.press("k"); await page.keyboard.up("Control");
  await wait(300);
  await clickText(page, "data-lab", "Data Lab", "open-data-lab");
  await clickText(page, "data-lab", "Browse", "data-lab-browse");
  await clickText(page, "data-lab", "Close", "close-data-lab");
}, []);

await runSurface("studios-hub", async (page) => {
  await enterChat(page, "studios-hub");
  await clickSelector(page, "studios-hub", "#plus-menu-button", "open-plus-menu");
  await clickText(page, "studios-hub", "All Studios", "open-studios");
  for (const item of ["Chat", "Voice", "Camera", "Deep Research", "Build Mode", "Design Studio", "Music Studio", "Fact Check", "Data Lab"]) {
    await clickText(page, "studios-hub", item, `studio-${item}`);
  }
}, []);

await runSurface("design-studio", async (page) => {
  await enterChat(page, "design-studio");
  await clickSelector(page, "design-studio", "#plus-menu-button", "open-plus-menu");
  await clickText(page, "design-studio", "Design Studio", "open-design-studio");
  await clickText(page, "design-studio", "Upload image", "design-upload");
  await clickText(page, "design-studio", "Close", "close-design-empty");
}, []);

await runSurface("music-studio", async (page) => {
  await enterChat(page, "music-studio");
  await clickSelector(page, "music-studio", "#plus-menu-button", "open-plus-menu");
  await clickText(page, "music-studio", "Music Studio", "open-music-studio");
  for (const mood of ["Chill", "Focus", "Energetic", "Dark", "Happy", "Epic", "Sad"]) {
    await clickText(page, "music-studio", mood, `mood-${mood}`);
  }
  await clickText(page, "music-studio", "Compose another take", "compose-another");
  await clickText(page, "music-studio", "Close", "close-music");
}, []);

await runSurface("command-palette", async (page) => {
  await enterChat(page, "command-palette");
  await page.keyboard.down("Control"); await page.keyboard.press("k"); await page.keyboard.up("Control");
  await wait(400);
  await shot(page, "command-palette", "open");
  for (const item of ["Chat", "Voice", "Agent", "Camera", "Deep Research", "New Gem", "Data Lab", "Generate image"]) {
    await clickText(page, "command-palette", item, `palette-${item}`);
    await page.keyboard.down("Control"); await page.keyboard.press("k"); await page.keyboard.up("Control"); await wait(250);
  }
  await page.keyboard.press("Escape");
}, []);

await runSurface("camera-mode", async (page) => {
  await enterChat(page, "camera-mode");
  await clickText(page, "camera-mode", "Camera mode", "open-camera");
  await clickText(page, "camera-mode", "Retry camera", "camera-retry");
  await clickText(page, "camera-mode", "Upload photo", "camera-upload");
  await clickText(page, "camera-mode", "Back to chat", "camera-back");
}, []);

const report = {
  url,
  chromiumPath,
  screenshotCount,
  blockedRequests,
  errors: [...new Set(errors)],
  results,
  flows: [...new Set(results.map((item) => item.flow))],
  successfulControls: results.filter((item) => (item.kind === "control" || item.kind === "selector") && item.ok).length,
  failedControls: results.filter((item) => (item.kind === "control" || item.kind === "selector") && !item.ok).length,
  notCompleted: results.filter((item) => item.completion || item.kind === "filechooser" || item.kind === "popup"),
};
writeFileSync(`${outDir}/crucial-flow-report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify({
  screenshotCount,
  blockedRequests,
  flows: report.flows,
  successfulControls: report.successfulControls,
  failedControls: report.failedControls,
  notCompleted: report.notCompleted,
  errors: report.errors,
}, null, 2));