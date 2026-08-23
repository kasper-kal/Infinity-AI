import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const url = process.env.infinity-ai_QA_URL || "http://localhost:21662/";
const outDir = process.env.infinity-ai_QA_OUT || "./qa-report/exhaustive-clicks";
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

const errors = [];
const clicks = [];
let screenshotIndex = 0;
let requestBlocks = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeName = (value) =>
  String(value || "state")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "state";

function attachPage(page, name) {
  page.setRequestInterception(true);
  page.on("request", (request) => {
    const method = request.method();
    const requestUrl = request.url();
    const mutatingApi =
      requestUrl.includes("/api/") &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    const externalAuth =
      requestUrl.includes("/api/infinity-ai/gmail/auth") ||
      requestUrl.includes("/api/infinity-ai/spotify/auth");
    if (mutatingApi || externalAuth) {
      requestBlocks += 1;
      request.abort().catch(() => {});
    } else {
      request.continue().catch(() => {});
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`[${name}] console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`[${name}] pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.url().includes("localhost")) {
      errors.push(
        `[${name}] requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`,
      );
    }
  });
  page.on("popup", async (popup) => {
    errors.push(`[${name}] popup opened: ${popup.url()}`);
    await popup.close().catch(() => {});
  });
  page.on("dialog", async (dialog) => {
    clicks.push({ page: name, action: "dialog", type: dialog.type(), message: dialog.message() });
    await dialog.dismiss().catch(() => {});
  });
  page.on("filechooser", (chooser) => {
    clicks.push({ page: name, action: "filechooser", accepted: false });
    chooser.cancel().catch(() => {});
  });
}

async function screenshot(page, label) {
  screenshotIndex += 1;
  const file = `${String(screenshotIndex).padStart(3, "0")}-${safeName(label)}.png`;
  await page.screenshot({ path: `${outDir}/${file}`, fullPage: false });
  return file;
}

async function inventory(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("button,[role='button']")].map((element, index) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
      const title = element.getAttribute("title") || "";
      const aria = element.getAttribute("aria-label") || "";
      const key = [
        element.tagName,
        text,
        title,
        aria,
        element.className?.toString().slice(0, 120) || "",
        Math.round(rect.x),
        Math.round(rect.y),
        Math.round(rect.width),
        Math.round(rect.height),
      ].join("|");
      return {
        index,
        key,
        text,
        title,
        aria,
        disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none",
      };
    }),
  );
}

async function clickButton(page, pageName, descriptor, label) {
  const clicked = await page.evaluate(({ sweepId }) => {
    const element = document.querySelector(`[data-qa-sweep-id="${sweepId}"]`);
    if (!element) return { ok: false, reason: "not-found" };
    const style = getComputedStyle(element);
    if (
      element.disabled ||
      element.getAttribute("aria-disabled") === "true" ||
      style.visibility === "hidden" ||
      style.display === "none"
    ) {
      return { ok: false, reason: "not-clickable" };
    }
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { ok: false, reason: "not-clickable" };
    }
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const top = document.elementFromPoint(point.x, point.y);
    if (!top || (top !== element && !element.contains(top))) {
      return { ok: false, reason: "covered" };
    }
    return { ok: true, x: point.x, y: point.y };
  }, descriptor);
  if (clicked.ok) {
    await page.mouse.click(clicked.x, clicked.y).catch(() => {});
  }
  clicks.push({
    page: pageName,
    label,
    text: descriptor.text,
    title: descriptor.title,
    aria: descriptor.aria,
    ...clicked,
  });
  await wait(260);
  return clicked.ok;
}

async function clickVisibleButtons(page, pageName, label, rounds = 5) {
  const seen = new Set();
  const maxClicks = 100;
  let noProgress = 0;
  while (clicks.length < maxClicks && noProgress < 3) {
    const button = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll("button,[role='button']")];
      for (const element of candidates) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none";
        const disabled =
          element.disabled || element.getAttribute("aria-disabled") === "true";
        if (!visible || disabled) continue;
        const content = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
        const key = [
          element.tagName,
          content,
          element.getAttribute("title") || "",
          element.getAttribute("aria-label") || "",
        ].join("|");
        if (
          element.getAttribute("data-qa-sweep-seen") === "true" ||
          element.getAttribute("data-qa-sweep-deferred") === "true"
        ) continue;
        const sweepId = `qa-current-${Date.now()}`;
        element.setAttribute("data-qa-sweep-id", sweepId);
        return {
          sweepId,
          key,
          text: content,
          title: element.getAttribute("title") || "",
          aria: element.getAttribute("aria-label") || "",
        };
      }
      return null;
    });
    if (!button) break;
    if (seen.has(button.key)) {
      await page.evaluate((sweepId) => {
        document.querySelector(`[data-qa-sweep-id="${sweepId}"]`)?.setAttribute("data-qa-sweep-seen", "true");
      }, button.sweepId);
      noProgress += 1;
      continue;
    }
    const result = await clickButton(page, pageName, button, label);
    await page.evaluate((sweepId) => {
      const element = document.querySelector(`[data-qa-sweep-id="${sweepId}"]`);
      if (element) {
        element.removeAttribute("data-qa-sweep-id");
        element.setAttribute(result ? "data-qa-sweep-seen" : "data-qa-sweep-deferred", "true");
      }
    }, button.sweepId, result).catch(() => {});
    if (result) seen.add(button.key);
    if (result) noProgress = 0;
    else {
      noProgress += 1;
      if (noProgress >= 2) {
        await page.keyboard.press("Escape").catch(() => {});
        await wait(250);
        await page.evaluate(() => {
          document
            .querySelectorAll("[data-qa-sweep-deferred]")
            .forEach((element) => element.removeAttribute("data-qa-sweep-deferred"));
        });
        noProgress = 0;
      }
    }
    if (seen.size <= 80) {
      await screenshot(page, `${label}-${button.text || button.title || button.aria || "button"}`);
    }
  }
  return seen.size;
}

async function clickByText(page, pageName, text, label = text) {
  const button = await page.evaluate((needle) => {
    const elements = [...document.querySelectorAll("button,[role='button']")];
    let counter = 0;
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none";
      const disabled =
        element.disabled || element.getAttribute("aria-disabled") === "true";
      const content = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
      if (!visible || disabled || !content.includes(needle)) continue;
      const sweepId = `qa-explicit-${Date.now()}-${counter++}`;
      element.setAttribute("data-qa-sweep-id", sweepId);
      return {
        sweepId,
        key: [element.tagName, content, element.getAttribute("title") || "", element.getAttribute("aria-label") || ""].join("|"),
        text: content,
        title: element.getAttribute("title") || "",
        aria: element.getAttribute("aria-label") || "",
      };
    }
    return null;
  }, text);
  if (!button) {
    clicks.push({ page: pageName, label, ok: false, reason: "not-found" });
    return false;
  }
  await clickButton(page, pageName, button, label);
  await page.evaluate((sweepId) => {
    document.querySelector(`[data-qa-sweep-id="${sweepId}"]`)?.removeAttribute("data-qa-sweep-id");
  }, button.sweepId).catch(() => {});
  await screenshot(page, label);
  return true;
}

async function closeOverlays(page, pageName) {
  await page.keyboard.press("Escape").catch(() => {});
  await wait(200);
  const close = (await inventory(page)).find(
    (candidate) =>
      candidate.visible &&
      !candidate.disabled &&
      (candidate.aria.toLowerCase().includes("close") ||
        candidate.title.toLowerCase().includes("close") ||
        candidate.text.trim() === "Close" ||
        candidate.text.trim() === "Cancel"),
  );
  if (close) {
    await clickButton(page, pageName, close, "close-overlay");
    await wait(200);
  }
}

async function runPage(page, pageName, viewport) {
  attachPage(page, pageName);
  await page.setViewport(viewport);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(2500);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(1800);
  await screenshot(page, `${pageName}-home`);

  const initialInventory = await inventory(page);
  writeFileSync(`${outDir}/${pageName}-initial-inventory.json`, JSON.stringify(initialInventory, null, 2));

  // Click all controls available in the initial mode.
  await clickVisibleButtons(page, pageName, `${pageName}-initial`, 3);
  await closeOverlays(page, pageName);

  // Explicitly open and sweep the major top-level surfaces.
  for (const surface of [
    "Chat",
    "Voice",
    "Agent",
    "Camera",
    "Settings",
    "Deep Research",
    "All Studios",
    "Design Studio",
    "Music Studio",
    "Data Lab",
    "New Gem",
  ]) {
    await clickByText(page, pageName, surface, `${pageName}-open-${surface}`);
    await clickVisibleButtons(page, pageName, `${pageName}-${surface}`, 4);
    await closeOverlays(page, pageName);
  }

  // Command palette is keyboard-invoked rather than always rendered.
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  await wait(350);
  await screenshot(page, `${pageName}-command-palette`);
  await clickVisibleButtons(page, pageName, `${pageName}-command-palette`, 4);
  await closeOverlays(page, pageName);

  const finalInventory = await inventory(page);
  writeFileSync(`${outDir}/${pageName}-final-inventory.json`, JSON.stringify(finalInventory, null, 2));
  return { initialInventory, finalInventory };
}

const desktop = await runPage(await browser.newPage(), "desktop", { width: 1440, height: 900 });
const mobile = await runPage(await browser.newPage(), "mobile", { width: 390, height: 844 });

const report = {
  url,
  chromiumPath,
  generatedAt: new Date().toISOString(),
  screenshots: screenshotIndex,
  clickAttempts: clicks.length,
  successfulClicks: clicks.filter((click) => click.ok).length,
  failedOrBlockedClicks: clicks.filter((click) => click.ok === false).length,
  requestBlocks,
  errors: [...new Set(errors)],
  clicks,
  desktop: {
    initialButtons: desktop.initialInventory.length,
    finalButtons: desktop.finalInventory.length,
  },
  mobile: {
    initialButtons: mobile.initialInventory.length,
    finalButtons: mobile.finalInventory.length,
  },
};
writeFileSync(`${outDir}/click-sweep-report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));