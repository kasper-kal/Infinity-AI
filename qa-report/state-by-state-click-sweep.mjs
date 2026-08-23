import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const url = process.env.infinity-ai_QA_URL || "http://localhost:21662/";
const outDir = process.env.infinity-ai_QA_OUT || "./qa-report/state-clicks";
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
let screenshotNo = 0;
let blockedRequests = 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stateNames = [
  "voice-home",
  "voice-history",
  "voice-menu",
  "chat-home",
  "chat-plus",
  "chat-research",
  "chat-gem",
  "chat-studios",
  "chat-design",
  "chat-music",
  "chat-datalab",
  "chat-settings",
  "chat-palette",
  "chat-sidebar",
  "agent-mode",
  "browser-mode",
  "camera-mode",
];

function hookPage(page, name) {
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
      requestUrl.includes("/api/infinity-ai/terminal") ||
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
    if (message.type() === "error") errors.push(`[${name}] console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`[${name}] pageerror: ${error.message}`));
  page.on("dialog", async (dialog) => {
    results.push({ state: name, kind: "dialog", type: dialog.type(), message: dialog.message() });
    await dialog.dismiss().catch(() => {});
  });
  page.on("filechooser", async (chooser) => {
    results.push({ state: name, kind: "filechooser", clicked: true });
    await chooser.cancel().catch(() => {});
  });
  page.on("popup", async (popup) => {
    results.push({ state: name, kind: "popup", url: popup.url(), clicked: true });
    await popup.close().catch(() => {});
  });
}

async function screenshot(page, state, label) {
  screenshotNo += 1;
  if (screenshotNo > 150) return;
  const filename = `${String(screenshotNo).padStart(3, "0")}-${state}-${label}`
    .replace(/[^a-z0-9._-]+/gi, "-")
    .slice(0, 110) + ".png";
  await page.screenshot({ path: `${outDir}/${filename}`, fullPage: false }).catch(() => {});
}

async function freshPage(state) {
  const page = await browser.newPage();
  hookPage(page, state);
  await page.setViewport({ width: state.includes("mobile") ? 390 : 1440, height: state.includes("mobile") ? 844 : 900 });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(1800);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(1200);
  return page;
}

async function controls(page) {
  return page.evaluate(() => [...document.querySelectorAll("button,[role='button']")].map((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    const title = element.getAttribute("title") || "";
    const aria = element.getAttribute("aria-label") || "";
      const id = element.id || "";
    const key = [
      element.tagName,
      text,
      title,
      aria,
        id,
      element.parentElement?.getAttribute("class")?.toString().slice(0, 100) || "",
    ].join("|");
    return {
      key,
      text,
      title,
      aria,
        id,
      visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
      disabled: Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true",
    };
  }));
}

async function clickTarget(page, state, target) {
  const result = await page.evaluate(({ target }) => {
    const elements = [...document.querySelectorAll("button,[role='button']")];
    const element = elements.find((candidate) => {
      const text = (candidate.innerText || candidate.textContent || "").replace(/\s+/g, " ").trim();
      const title = candidate.getAttribute("title") || "";
      const aria = candidate.getAttribute("aria-label") || "";
      const id = candidate.id || "";
      const parent = candidate.parentElement?.getAttribute("class")?.toString().slice(0, 100) || "";
      return [candidate.tagName, text, title, aria, id, parent].join("|") === target.key;
    });
    if (!element) return { ok: false, reason: "not-found" };
    if (element.disabled || element.getAttribute("aria-disabled") === "true") return { ok: false, reason: "disabled" };
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    return { ok: true };
  }, { target });
  results.push({ state, kind: "button", text: target.text, title: target.title, aria: target.aria, ...result });
  await wait(280);
  return result.ok;
}

async function clickOne(page, state, matcher, label) {
  const target = (await controls(page)).find((control) =>
    control.visible &&
    !control.disabled &&
    (typeof matcher === "function" ? matcher(control) : control.text.includes(matcher) || control.title.includes(matcher) || control.aria.includes(matcher)),
  );
  if (!target) {
    results.push({ state, kind: "expected-control", label, ok: false, reason: "not-found" });
    return false;
  }
  const ok = await clickTarget(page, state, target);
  await screenshot(page, state, label.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
  return ok;
}

async function sweepCurrentState(page, state, label) {
  const initial = await controls(page);
  const seen = new Set();
  let stalled = 0;
  const maxClicks = 45;
  while (seen.size < maxClicks && stalled < 6) {
    const available = (await controls(page)).filter((control) => control.visible && !control.disabled);
    const target = available.find((control) => {
      // Conversation rows are data instances, not distinct control types. Click
      // the first row and its row actions, then avoid an unbounded loop as each
      // row opens a different conversation and repopulates the sidebar.
      const semanticKey =
        control.text.startsWith("New Conversation") ? "conversation-row" :
        control.title === "Export as text" ? "export-action" :
        control.key;
      control.semanticKey = semanticKey;
      return !seen.has(semanticKey);
    });
    if (!target) {
      await page.keyboard.press("Escape").catch(() => {});
      await wait(180);
      const afterEscape = (await controls(page)).filter((control) => control.visible && !control.disabled);
      const retry = afterEscape.find((control) => {
        const semanticKey =
          control.text.startsWith("New Conversation") ? "conversation-row" :
          control.title === "Export as text" ? "export-action" :
          control.key;
        control.semanticKey = semanticKey;
        return !seen.has(semanticKey);
      });
      if (!retry) {
        stalled += 1;
        continue;
      }
      const ok = await clickTarget(page, state, retry);
      seen.add(retry.semanticKey);
      if (!ok) stalled += 1;
      else stalled = 0;
      await screenshot(page, state, `${label}-${retry.text || retry.title || retry.aria || "button"}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
      continue;
    }
    seen.add(target.semanticKey);
    const ok = await clickTarget(page, state, target);
    if (!ok) stalled += 1;
    else stalled = 0;
    await screenshot(page, state, `${label}-${target.text || target.title || target.aria || "button"}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
  }
  return { initial: initial.length, clicked: seen.size, final: (await controls(page)).length };
}

async function runState(state, setup) {
  const page = await freshPage(state);
  await screenshot(page, state, "initial");
  await setup(page);
  await wait(300);
  const summary = await sweepCurrentState(page, state, state);
  await page.close();
  return summary;
}

const states = {};
states["voice-home"] = await runState("voice-home", async () => {});
states["voice-history"] = await runState("voice-history", async (page) => {
  await clickOne(page, "voice-history", (c) => c.aria === "Back to chat", "back-to-chat");
  await clickOne(page, "voice-history", (c) => c.aria === "Open history", "open-history");
});
states["voice-menu"] = await runState("voice-menu", async (page) => {
  await clickOne(page, "voice-menu", (c) => c.aria === "Back to chat", "back-to-chat");
  await clickOne(page, "voice-menu", (c) => c.aria === "Menu", "menu");
});
states["chat-home"] = await runState("chat-home", async (page) => {
  await clickOne(page, "chat-home", (c) => c.aria === "Back to chat", "back-to-chat");
});
states["chat-plus"] = await runState("chat-plus", async (page) => {
  await clickOne(page, "chat-plus", (c) => c.aria === "Back to chat", "back-to-chat");
  await clickOne(page, "chat-plus", (c) => c.id === "plus-menu-button", "plus-menu");
});
states["chat-research"] = await runState("chat-research", async (page) => {
  await clickOne(page, "chat-research", (c) => c.aria === "Back to chat", "back-to-chat");
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  await wait(300);
  await clickOne(page, "chat-research", "Deep Research", "deep-research");
});
states["chat-gem"] = await runState("chat-gem", async (page) => {
  await clickOne(page, "chat-gem", (c) => c.aria === "Back to chat", "back-to-chat");
  await clickOne(page, "chat-gem", (c) => c.id === "plus-menu-button", "plus-menu");
  await clickOne(page, "chat-gem", "New Gem", "new-gem");
});
states["chat-studios"] = await runState("chat-studios", async (page) => {
  await clickOne(page, "chat-studios", (c) => c.aria === "Back to chat", "back-to-chat");
  await clickOne(page, "chat-studios", (c) => c.id === "plus-menu-button", "plus-menu");
  await clickOne(page, "chat-studios", "All Studios", "all-studios");
});
states["chat-design"] = await runState("chat-design", async (page) => {
  await clickOne(page, "chat-design", (c) => c.aria === "Back to chat", "back-to-chat");
  await clickOne(page, "chat-design", (c) => c.id === "plus-menu-button", "plus-menu");
  await clickOne(page, "chat-design", "Design Studio", "design-studio");
});
states["chat-music"] = await runState("chat-music", async (page) => {
  await clickOne(page, "chat-music", (c) => c.aria === "Back to chat", "back-to-chat");
  await clickOne(page, "chat-music", (c) => c.id === "plus-menu-button", "plus-menu");
  await clickOne(page, "chat-music", "Music Studio", "music-studio");
});
states["chat-datalab"] = await runState("chat-datalab", async (page) => {
  await clickOne(page, "chat-datalab", (c) => c.aria === "Back to chat", "back-to-chat");
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  await wait(300);
  await clickOne(page, "chat-datalab", "Data Lab", "data-lab");
});
states["chat-settings"] = await runState("chat-settings", async (page) => {
  await clickOne(page, "chat-settings", (c) => c.aria === "Back to chat", "back-to-chat");
  await clickOne(page, "chat-settings", (c) => c.aria === "Menu", "menu");
  await clickOne(page, "chat-settings", "Settings", "settings");
});
states["chat-palette"] = await runState("chat-palette", async (page) => {
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  await wait(300);
});
states["chat-sidebar"] = await runState("chat-sidebar", async (page) => {
  await clickOne(page, "chat-sidebar", (c) => c.aria === "Back to chat", "back-to-chat");
  await clickOne(page, "chat-sidebar", (c) => c.aria === "Open history", "open-history");
});
states["agent-mode"] = await runState("agent-mode", async (page) => {
  await clickOne(page, "agent-mode", (c) => c.aria === "Back to chat", "back-to-chat");
  await clickOne(page, "agent-mode", "Agent", "agent-mode");
});
states["browser-mode"] = await runState("browser-mode", async (page) => {
  await clickOne(page, "browser-mode", (c) => c.aria === "Back to chat", "back-to-chat");
  await clickOne(page, "browser-mode", "Browser", "browser-mode");
});
states["camera-mode"] = await runState("camera-mode", async (page) => {
  await clickOne(page, "camera-mode", (c) => c.aria === "Back to chat", "back-to-chat");
  await clickOne(page, "camera-mode", "Camera mode", "camera-mode");
});

const report = {
  url,
  chromiumPath,
  screenshotCount: screenshotNo,
  blockedRequests,
  errors: [...new Set(errors)],
  states,
  buttonResults: results,
  totalButtonAttempts: results.filter((item) => item.kind === "button").length,
  successfulButtonClicks: results.filter((item) => item.kind === "button" && item.ok).length,
  failedButtonClicks: results.filter((item) => item.kind === "button" && !item.ok).length,
  missingExpectedControls: results.filter((item) => item.kind === "expected-control" && !item.ok),
};
writeFileSync(`${outDir}/state-click-report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify({
  screenshotCount: report.screenshotCount,
  blockedRequests: report.blockedRequests,
  errors: report.errors,
  totalButtonAttempts: report.totalButtonAttempts,
  successfulButtonClicks: report.successfulButtonClicks,
  failedButtonClicks: report.failedButtonClicks,
  missingExpectedControls: report.missingExpectedControls,
  states: report.states,
}, null, 2));