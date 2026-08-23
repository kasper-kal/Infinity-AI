import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const url = process.env.infinity-ai_QA_URL || "http://localhost:21662/";
const outDir = process.env.infinity-ai_QA_OUT || "./qa-report/complete-button-pass";
mkdirSync(outDir, { recursive: true });
const chromiumPath =
  process.env.CHROMIUM_PATH ||
  execFileSync("sh", ["-lc", "command -v chromium"], { encoding: "utf8" }).trim();
const browser = await puppeteer.launch({
  headless: true,
  executablePath: chromiumPath,
  defaultViewport: { width: 1440, height: 900 },
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
const screenshots = [];
const protectedControls = [];
let screenshotNo = 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

function classify(control) {
  const value = `${control.text} ${control.aria} ${control.title}`.toLowerCase();
  if (/api key|llm key|secret|remove key|delete key|revoke/.test(value)) return "protected-api-key";
  if (/connect gmail|connect spotify/.test(value)) return "oauth";
  if (/clear all|delete all|delete conversation|remove conversation/.test(value)) return "destructive";
  if (/attach|upload|file|image|photo|snapshot|screen share|camera/.test(value)) return "media";
  return "normal";
}

function isDuplicateDataControl(control) {
  return /^new conversation\b/i.test(control.text) ||
    /^conversation\b/i.test(control.text) ||
    control.title === "Export as text";
}

async function takeScreenshot(page, label) {
  screenshotNo += 1;
  const filename = `${String(screenshotNo).padStart(4, "0")}-${label}`
    .replace(/[^a-z0-9._-]+/gi, "-")
    .slice(0, 120) + ".png";
  await page.screenshot({ path: `${outDir}/${filename}`, fullPage: false }).catch(() => {});
  screenshots.push(filename);
  return filename;
}

function installObservers(page, flow) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`[${flow}] ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`[${flow}] pageerror: ${error.message}`));
  page.on("dialog", async (dialog) => {
    results.push({
      flow,
      kind: "browser-dialog",
      type: dialog.type(),
      message: dialog.message(),
      outcome: "dismissed",
    });
    await dialog.dismiss().catch(() => {});
  });
  page.on("popup", async (popup) => {
    await wait(1200);
    const externalScreenshot = await takeScreenshot(popup, `${flow}-oauth-login`).catch(() => null);
    results.push({
      flow,
      kind: "oauth-popup",
      url: popup.url(),
      screenshot: externalScreenshot,
      outcome: "opened-without-login",
    });
    await popup.close().catch(() => {});
  });
}

async function fresh(flow) {
  const page = await browser.newPage();
  installObservers(page, flow);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(1200);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(900);
  return page;
}

async function inventory(page) {
  return page.evaluate(() => [...document.querySelectorAll("button,[role='button'],[role='tab']")]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
      const control = {
        tag: element.tagName,
        id: element.id || "",
        text,
        aria: element.getAttribute("aria-label") || "",
        title: element.getAttribute("title") || "",
        disabled: Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true",
        visible: rect.width > 0 && rect.height > 0 &&
          style.display !== "none" && style.visibility !== "hidden",
      };
      control.signature = [
        control.tag,
        control.id,
        control.text,
        control.aria,
        control.title,
      ].join("|");
      return control;
    })
    .filter((control) => control.visible && !control.disabled));
}

async function activate(page, target) {
  return page.evaluate((target) => {
    const elements = [...document.querySelectorAll("button,[role='button'],[role='tab']")];
    const element = elements.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      const text = (candidate.innerText || candidate.textContent || "").replace(/\s+/g, " ").trim();
      const signature = [
        candidate.tagName,
        candidate.id || "",
        text,
        candidate.getAttribute("aria-label") || "",
        candidate.getAttribute("title") || "",
      ].join("|");
      return signature === target.signature &&
        rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden" &&
        !candidate.disabled;
    });
    if (!element) return { ok: false, reason: "not-found-after-rescan" };
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    return { ok: true };
  }, target);
}

async function clickByText(page, needle) {
  const controls = await inventory(page);
  const target = controls.find((control) =>
    control.text === needle ||
    control.text.includes(needle) ||
    control.aria === needle ||
    control.title === needle,
  );
  if (!target) return false;
  return (await activate(page, target)).ok;
}

async function clickById(page, id) {
  const controls = await inventory(page);
  const target = controls.find((control) => control.id === id);
  if (!target) return false;
  return (await activate(page, target)).ok;
}

async function enterChat(page) {
  await clickByText(page, "Back to chat");
  await wait(250);
}

async function openSettings(page) {
  await enterChat(page);
  await clickByText(page, "Menu");
  await wait(150);
  await clickByText(page, "Settings");
  await wait(350);
}

async function sweepSurface(flow, setup, limit = 28) {
  const page = await fresh(flow);
  await setup(page);
  await wait(300);
  await takeScreenshot(page, `${flow}-initial`);
  const seen = new Set();
  let attempts = 0;
  while (attempts < limit) {
    const controls = await inventory(page);
    const target = controls.find((control) =>
      !seen.has(control.signature) && !isDuplicateDataControl(control));
    if (!target) break;
    seen.add(target.signature);
    attempts += 1;
    const kind = classify(target);
    if (kind === "protected-api-key") {
      protectedControls.push({ flow, control: target, reason: "API-key action not pressed" });
      results.push({ flow, kind: "button", control: target, category: kind, outcome: "protected-not-pressed" });
      continue;
    }
    const outcome = await activate(page, target);
    await wait(300);
    const after = await takeScreenshot(page, `${flow}-${attempts}-${target.text || target.aria || target.title || "button"}`);
    results.push({ flow, kind: "button", control: target, category: kind, outcome, after });
  }
  results.push({
    flow,
    kind: "surface-summary",
    uniqueControlsActivatedOrProtected: seen.size,
    attempts,
    remainingVisibleControls: (await inventory(page)).length,
  });
  await page.close();
}

// Top-level surfaces.
await sweepSurface("voice-home", async () => {});
await sweepSurface("chat-home", enterChat);
await sweepSurface("plus-menu", async (page) => {
  await enterChat(page);
  await clickById(page, "plus-menu-button");
});
await sweepSurface("sidebar", async (page) => {
  await enterChat(page);
  await clickByText(page, "Open history");
});
await sweepSurface("command-palette", async (page) => {
  await enterChat(page);
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  await wait(350);
});
await sweepSurface("research", async (page) => {
  await enterChat(page);
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  await wait(350);
  await clickByText(page, "Deep Research");
});
await sweepSurface("gem", async (page) => {
  await enterChat(page);
  await clickById(page, "plus-menu-button");
  await clickByText(page, "New Gem");
});
await sweepSurface("studios", async (page) => {
  await enterChat(page);
  await clickById(page, "plus-menu-button");
  await clickByText(page, "All Studios");
});
await sweepSurface("design-studio", async (page) => {
  await enterChat(page);
  await clickById(page, "plus-menu-button");
  await clickByText(page, "Design Studio");
});
await sweepSurface("music-studio", async (page) => {
  await enterChat(page);
  await clickById(page, "plus-menu-button");
  await clickByText(page, "Music Studio");
});
await sweepSurface("data-lab", async (page) => {
  await enterChat(page);
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  await wait(350);
  await clickByText(page, "Data Lab");
});
await sweepSurface("camera", async (page) => {
  await enterChat(page);
  await clickByText(page, "Camera mode");
});
await sweepSurface("agent", async (page) => {
  await enterChat(page);
  await clickByText(page, "Agent");
}, 30);
await sweepSurface("browser", async (page) => {
  await enterChat(page);
  await clickByText(page, "Browser");
}, 30);

// Settings home and each subview get an independent fresh state.
for (const label of [
  "Personalization",
  "Memory",
  "Language",
  "Gmail",
  "Spotify",
  "Accent color",
  "Web search & data",
  "LLM keys",
  "About",
]) {
  const name = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await sweepSurface(`settings-${name}`, async (page) => {
    await openSettings(page);
    await clickByText(page, label);
    await wait(250);
  }, 35);
}

// OAuth entry points are explicitly allowed to open, but no login or consent.
for (const provider of ["Gmail", "Spotify"]) {
  const flow = `oauth-${provider.toLowerCase()}`;
  const page = await fresh(flow);
  await openSettings(page);
  await clickByText(page, provider);
  await wait(300);
  const controls = await inventory(page);
  const connect = controls.find((control) => /connect/i.test(`${control.text} ${control.aria} ${control.title}`));
  if (connect) {
    const outcome = await activate(page, connect);
    results.push({ flow, kind: "oauth-button", control: connect, outcome, outcomePolicy: "no-login-no-consent" });
    await wait(1800);
  } else {
    results.push({ flow, kind: "oauth-button", outcome: { ok: false, reason: "connect-control-not-found" } });
  }
  await page.close();
}

// Final reset: use the app UI to clear chat data, then confirm that chat list is empty.
const resetFlow = "final-reset";
const resetPage = await fresh(resetFlow);
await enterChat(resetPage);
await clickByText(resetPage, "Open history");
await wait(350);
const beforeReset = await takeScreenshot(resetPage, "final-reset-before");
const resetControls = await inventory(resetPage);
const clear = resetControls.find((control) =>
  /clear all/i.test(`${control.text} ${control.aria} ${control.title}`));
if (clear) {
  const clicked = await activate(resetPage, clear);
  await wait(300);
  const confirmationControls = await inventory(resetPage);
  const confirm = confirmationControls.find((control) =>
    /clear all|delete all|confirm/i.test(`${control.text} ${control.aria} ${control.title}`) &&
    !/cancel/i.test(`${control.text} ${control.aria} ${control.title}`));
  if (confirm) {
    const confirmed = await activate(resetPage, confirm);
    await wait(900);
    const afterReset = await takeScreenshot(resetPage, "final-reset-after");
    results.push({
      flow: resetFlow,
      kind: "reset",
      beforeReset,
      clearButton: clear,
      clicked,
      confirmationButton: confirm,
      confirmed,
      afterReset,
      outcome: "chat-reset-requested-through-ui",
    });
  } else {
    results.push({ flow: resetFlow, kind: "reset", clicked, outcome: "confirmation-not-found" });
  }
} else {
  results.push({ flow: resetFlow, kind: "reset", outcome: "clear-all-not-found" });
}
await resetPage.close();

const report = {
  url,
  chromiumPath,
  screenshotCount: screenshotNo,
  screenshots,
  protectedControls,
  errors: [...new Set(errors)],
  results,
  counts: {
    buttonRecords: results.filter((result) => result.kind === "button").length,
    successfulActivations: results.filter((result) =>
      result.kind === "button" && result.outcome?.ok).length,
    failedActivations: results.filter((result) =>
      result.kind === "button" && result.outcome && !result.outcome.ok).length,
    protectedApiKeyControls: protectedControls.length,
    oauthButtons: results.filter((result) => result.kind === "oauth-button").length,
    oauthPopups: results.filter((result) => result.kind === "oauth-popup").length,
  },
};
writeFileSync(`${outDir}/complete-button-and-reset-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  counts: report.counts,
  screenshotCount: report.screenshotCount,
  errors: report.errors.slice(0, 30),
  reset: results.filter((result) => result.flow === resetFlow),
}, null, 2));
await browser.close();