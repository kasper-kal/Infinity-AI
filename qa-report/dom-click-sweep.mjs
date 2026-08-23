import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const url = process.env.infinity-ai_QA_URL || "http://localhost:21662/";
const outDir = process.env.infinity-ai_QA_OUT || "./qa-report/dom-clicks";
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

function attach(page, name) {
  page.setRequestInterception(true);
  page.on("request", (request) => {
    const requestUrl = request.url();
    const method = request.method();
    const externalOrExpensive =
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
    if (externalOrExpensive) {
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
  page.on("dialog", (dialog) => {
    results.push({ page: name, action: "dialog", type: dialog.type(), message: dialog.message() });
    dialog.dismiss().catch(() => {});
  });
  page.on("filechooser", (chooser) => {
    results.push({ page: name, action: "filechooser", activated: true });
    chooser.cancel().catch(() => {});
  });
  page.on("popup", (popup) => {
    results.push({ page: name, action: "popup", url: popup.url(), activated: true });
    popup.close().catch(() => {});
  });
}

async function shot(page, label) {
  screenshotNo += 1;
  if (screenshotNo > 100) return;
  const filename = `${String(screenshotNo).padStart(3, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 70)}.png`;
  await page.screenshot({ path: `${outDir}/${filename}`, fullPage: false }).catch(() => {});
}

async function scan(page) {
  return page.evaluate(() => {
    const elements = [...document.querySelectorAll("button,[role='button']")];
    return elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
      const title = element.getAttribute("title") || "";
      const aria = element.getAttribute("aria-label") || "";
      const parent = element.parentElement?.getAttribute("class")?.toString().slice(0, 120) || "";
      const key = [element.tagName, text, title, aria, parent].join("|");
      return {
        index,
        key,
        text,
        title,
        aria,
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none",
        disabled:
          Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true",
      };
    });
  });
}

async function activate(page, pageName, candidate, reason) {
  const activation = await page.evaluate(({ target }) => {
    const elements = [...document.querySelectorAll("button,[role='button']")];
    const element = elements.find((candidate) => {
      const text = (candidate.innerText || candidate.textContent || "").replace(/\s+/g, " ").trim();
      const title = candidate.getAttribute("title") || "";
      const aria = candidate.getAttribute("aria-label") || "";
      const parent = candidate.parentElement?.getAttribute("class")?.toString().slice(0, 120) || "";
      return [candidate.tagName, text, title, aria, parent].join("|") === target.key;
    });
    if (!element) return { ok: false, reason: "not-found" };
    if (element.disabled || element.getAttribute("aria-disabled") === "true") {
      return { ok: false, reason: "disabled" };
    }
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    return { ok: true };
  }, { target: candidate });
  results.push({
    page: pageName,
    action: "button",
    reason,
    text: candidate.text,
    title: candidate.title,
    aria: candidate.aria,
    ...activation,
  });
  await wait(220);
  return activation.ok;
}

async function sweep(page, pageName, viewport) {
  attach(page, pageName);
  await page.setViewport(viewport);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(1800);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(1800);
  await shot(page, `${pageName}-home`);

  const activatedKeys = new Set();
  let stalled = 0;
  const maxActivations = 260;
  while (results.filter((item) => item.page === pageName && item.action === "button").length < maxActivations && stalled < 8) {
    const available = (await scan(page)).filter((candidate) => candidate.visible && !candidate.disabled);
    const candidate = available.find((item) => !activatedKeys.has(item.key));
    if (!candidate) {
      await page.keyboard.press("Escape").catch(() => {});
      await wait(180);
      const afterEscape = (await scan(page)).filter((item) => item.visible && !item.disabled);
      const newCandidate = afterEscape.find((item) => !activatedKeys.has(item.key));
      if (!newCandidate) {
        stalled += 1;
        continue;
      }
    }
    const target = candidate || (await scan(page)).find((item) => item.visible && !item.disabled && !activatedKeys.has(item.key));
    if (!target) continue;
    activatedKeys.add(target.key);
    const ok = await activate(page, pageName, target, "live-dom-click");
    if (!ok) stalled += 1;
    else {
      stalled = 0;
      if (activatedKeys.size <= 100) {
        await shot(page, `${pageName}-${target.text || target.title || target.aria || "button"}`);
      }
    }
  }
  const final = await scan(page);
  writeFileSync(`${outDir}/${pageName}-final-buttons.json`, JSON.stringify(final, null, 2));
  return { activated: activatedKeys.size, finalButtons: final.length };
}

const desktop = await sweep(await browser.newPage(), "desktop", { width: 1440, height: 900 });
const mobile = await sweep(await browser.newPage(), "mobile", { width: 390, height: 844 });
const report = {
  url,
  chromiumPath,
  screenshotCount: screenshotNo,
  blockedRequests,
  errors: [...new Set(errors)],
  buttonActivations: results.filter((item) => item.action === "button"),
  desktop,
  mobile,
};
writeFileSync(`${outDir}/dom-click-report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify({
  screenshotCount: report.screenshotCount,
  blockedRequests: report.blockedRequests,
  errors: report.errors,
  desktop: report.desktop,
  mobile: report.mobile,
  attempted: report.buttonActivations.length,
  successful: report.buttonActivations.filter((item) => item.ok).length,
  failed: report.buttonActivations.filter((item) => !item.ok).length,
}, null, 2));