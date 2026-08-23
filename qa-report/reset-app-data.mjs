import puppeteer from "puppeteer";
import { execFileSync } from "node:child_process";

const url = process.env.infinity-ai_QA_URL || "http://localhost:21662/";
const chromiumPath =
  process.env.CHROMIUM_PATH ||
  execFileSync("sh", ["-lc", "command -v chromium"], { encoding: "utf8" }).trim();

const browser = await puppeteer.launch({
  headless: true,
  executablePath: chromiumPath,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--mute-audio"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function visibleControls() {
  return page.evaluate(() =>
    [...document.querySelectorAll("button,[role='button']")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => ({
        text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim(),
        aria: element.getAttribute("aria-label") || "",
        title: element.getAttribute("title") || "",
      })),
  );
}

async function clickMatch(match) {
  const clicked = await page.evaluate((needle) => {
    const elements = [...document.querySelectorAll("button,[role='button']")];
    const element = elements.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return false;
      const value = [
        candidate.innerText || candidate.textContent || "",
        candidate.getAttribute("aria-label") || "",
        candidate.getAttribute("title") || "",
      ].join(" ").replace(/\s+/g, " ").trim();
      return value === needle || value.includes(needle);
    });
    if (!element) return false;
    element.scrollIntoView({ block: "center" });
    element.click();
    return true;
  }, match);
  await wait(500);
  return clicked;
}

async function snapshot(label) {
  const controls = await visibleControls();
  await page.screenshot({
    path: `qa-report/complete-button-pass/reset-${label}.png`,
  });
  return controls;
}

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await wait(1300);
const initial = await snapshot("initial");
const enteredChat = await clickMatch("Back to chat");
const afterChat = await snapshot("after-chat");
const openedHistory = await clickMatch("Open history");
const beforeClear = await snapshot("before-clear");
const openedClear = await clickMatch("Clear All");
const confirmation = await snapshot("confirmation");
const confirmed = await clickMatch("Delete All");
await wait(1000);
const afterDelete = await snapshot("after-delete");

const report = {
  url,
  initial,
  enteredChat,
  afterChat,
  openedHistory,
  beforeClear,
  openedClear,
  confirmation,
  confirmed,
  afterDelete,
  errors,
  result:
    confirmed &&
    !afterDelete.some((control) => /clear all/i.test(`${control.text} ${control.aria} ${control.title}`))
      ? "chat-reset-completed"
      : "chat-reset-not-confirmed",
};

console.log(JSON.stringify(report, null, 2));
await browser.close();