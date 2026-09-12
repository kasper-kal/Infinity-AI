#!/usr/bin/env node
/**
 * bench/verify.mjs — the vision verification instrument ("the reporter can only lose").
 *
 * Loads a built app in headless Chrome, runs a GENERIC suite (HTTP ok, no
 * console errors, responsive at 320/768/1440, no horizontal scroll, no
 * `[object Object]`, real screenshot) PLUS the app's own acceptance criteria
 * from `out/<slug>/verify.spec.mjs`, then writes `verify.json` (the verdict)
 * and exits 0 iff every check passed.
 *
 * Usage:
 *   node verify.mjs <app-dir> [--url http://host:port] [--widths 320,768,1440]
 *                    [--no-screenshot] [--serve] [--port 0]
 *   --serve  : run a zero-dependency static server on the app dir (default).
 *   --url    : skip the server; verify an already-served URL.
 *
 * A spec file (`appDir/verify.spec.mjs`) is optional and exports:
 *   export const readySelector = "#app";                 // wait for render
 *   export async function checks(page, ctx) { return [ {name, pass, detail} ] }
 *   export async function after(page, ctx) {}            // runs after checks (e.g. interactions)
 */
import { createServer } from "node:http";
import { readFile, stat, writeFile, mkdir, access } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
};

/**
 * Zero-dependency static file server (index-html aware, traversal-guarded).
 */
export function createStaticServer(rootDir, port = 0) {
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    // dev-server behavior: browsers always ask for favicon — answer 204, don't log a 404
    if (urlPath === "/favicon.ico" || urlPath === "/favicon.png") {
      res.writeHead(204).end();
      return;
    }
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const target = path.resolve(rootDir, rel);
    if (!target.startsWith(path.resolve(rootDir) + path.sep) && target !== path.resolve(rootDir, "index.html")) {
      res.writeHead(403).end("forbidden");
      return;
    }
    try {
      await stat(target);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }
    const type = MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    createReadStream(target).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url") a.url = argv[++i];
    else if (arg === "--widths") a.widths = argv[++i].split(",").map(Number);
    else if (arg === "--no-screenshot") a.noScreenshot = true;
    else if (arg === "--serve") a.serve = true;
    else if (arg === "--port") a.port = Number(argv[++i]);
    else if (arg === "--no-serve") a.noServe = true;
    else if (arg === "--help") a.help = true;
    else if (!a.appDir) a.appDir = arg;
  }
  if (!a.appDir) {
    console.error("usage: node verify.mjs <app-dir> [flags]");
    process.exit(2);
  }
  a.appDir = path.resolve(a.appDir);
  a.widths = a.widths ?? [320, 768, 1440];
  return a;
}

/** Load the optional per-app spec. Returns {checks, after, readySelector}. */
async function loadSpec(appDir) {
  const specPath = path.join(appDir, "verify.spec.mjs");
  try {
    await stat(specPath);
    const mod = await import(pathToFileURL(specPath).href + `?${Date.now()}`);
    return {
      readySelector: mod.readySelector,
      checks: mod.checks,
      after: mod.after,
    };
  } catch (e) {
    if (e && e.code === "ENOENT") return {};
    throw e;
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) return;

  const { default: puppeteer } = await import("puppeteer");

  const appDir = a.appDir;
  const slug = path.basename(appDir);
  let url = a.url;
  let server = null;

  if (!url && !a.noServe) {
    server = await createStaticServer(appDir, a.port ?? 0);
    const port = server.address().port;
    url = `http://127.0.0.1:${port}/`;
  }

  const checks = [];
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const failure = (name, detail) => ({ name, pass: false, detail });

  const spec = await loadSpec(appDir);

  let browser;
  let screenshotRel = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: a.widths[0], height: 800, deviceScaleFactor: 1 });

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`pageerror: ${String(err.message ?? err)}`));
    page.on("requestfailed", (req) => {
      if (!req.url().startsWith("data:")) failedRequests.push(`${req.url()} :: ${req.failure()?.errorText}`);
    });

    // ---- HTTP / load
    const httpStatus = await new Promise((resolve) => {
      page.goto(url, { waitUntil: "networkidle0", timeout: 30000 }).then((r) => resolve(r?.status() ?? 0), () => resolve(0));
    });
    checks.push(httpStatus === 200
      ? { name: "http_200", pass: true, detail: `GET ${url} → 200` }
      : failure("http_200", `GET ${url} → ${httpStatus}`));

    if (spec.readySelector) {
      try {
        await page.waitForSelector(spec.readySelector, { timeout: 10000 });
        checks.push({ name: "ready_selector", pass: true, detail: `#${spec.readySelector} rendered` });
      } catch {
        checks.push(failure("ready_selector", `selector '${spec.readySelector}' never appeared`));
      }
    } else {
      checks.push({ name: "page_rendered", pass: (await page.evaluate(() => Boolean(document.body?.innerText))), detail: "body has rendered text" });
    }

    // ---- generic DOM / text checks
    const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
    checks.push(
      bodyText.includes("[object Object]")
        ? failure("no_object_object", "rendered text contains '[object Object]'")
        : { name: "no_object_object", pass: true, detail: "no [object Object] in text" }
    );

    // ---- app-specific acceptance checks (live DOM exercise)
    let appChecks = [];
    if (spec.checks) {
      appChecks = await spec.checks(page, { appDir, url, log: (line) => process.stdout.write(`   · ${line}\n`) });
    }
    checks.push(...appChecks.map((c) => ({ name: "spec:" + c.name, pass: c.pass, detail: c.detail ?? "" })));
    if (!spec.checks) {
      checks.push({ name: "spec_file", pass: false, detail: "no verify.spec.mjs found — app criteria not exercised" });
    }

    // ---- post-interaction pass (many criteria only show after use)
    await page.setViewport({ width: 1280, height: 900 });
    if (spec.after) {
      try {
        await spec.after(page, { appDir, url });
      } catch (e) {
        checks.push(failure("after_hook", `after() threw: ${String(e?.message ?? e)}`));
      }
    }

    // ---- console/page/failed-request gates (checked after interaction)
    checks.push(
      consoleErrors.length === 0
        ? { name: "no_console_errors", pass: true, detail: "zero console.error while exercising the app" }
        : failure("no_console_errors", consoleErrors.slice(0, 5).join(" | "))
    );
    checks.push(
      pageErrors.length === 0
        ? { name: "no_page_errors", pass: true, detail: "zero uncaught page errors" }
        : failure("no_page_errors", pageErrors.slice(0, 5).join(" | "))
    );
    checks.push(
      failedRequests.length === 0
        ? { name: "no_failed_requests", pass: true, detail: "all network requests succeeded" }
        : failure("no_failed_requests", failedRequests.slice(0, 5).join(" | "))
    );

    // ---- responsiveness: no horizontal scroll at each width
    let lastInnerWidth = a.widths[0];
    for (const width of a.widths) {
      await page.setViewport({ width, height: 800 });
      const { scrollW, innerW, hasHScroll } = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        hasHScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      }));
      lastInnerWidth = innerW;
      checks.push(
        hasHScroll
          ? failure(`responsive_${width}`, `horizontal scroll at ${width}px (doc ${scrollW}px > viewport ${innerW}px)`)
          : { name: `responsive_${width}`, pass: true, detail: `no horizontal scroll at ${width}px (scrollW=${scrollW} viewport=${innerW})` }
      );
    }

    // ---- screenshot (real pixel artifact)
    if (!a.noScreenshot) {
      await page.setViewport({ width: 1440, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await new Promise((r) => setTimeout(r, 300));
      const shotPath = path.join(appDir, "screenshot.png");
      await mkdir(path.dirname(shotPath), { recursive: true });
      await page.screenshot({ path: shotPath, fullPage: true });
      const st = await stat(shotPath);
      screenshotRel = "screenshot.png";
      checks.push(
        st.size > 0
          ? { name: "screenshot", pass: true, detail: `${path.basename(shotPath)} ${(st.size / 1024).toFixed(1)}KiB` }
          : failure("screenshot", "screenshot file empty")
      );
    }
    await page.close();
  } catch (e) {
    checks.push(failure("harness_error", `verify.mjs crashed: ${String(e?.stack ?? e)}`));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  if (server) server.close();

  const allPass = checks.length > 0 && checks.every((c) => c.pass);
  const result = {
    schema: 1,
    slug,
    url: url ?? null,
    checkedAt: new Date().toISOString(),
    allPass,
    passCount: checks.filter((c) => c.pass).length,
    failCount: checks.filter((c) => !c.pass).length,
    checks,
    consoleErrors: consoleErrors.slice(0, 10),
    pageErrors: pageErrors.slice(0, 10),
    failedRequests: failedRequests.slice(0, 10),
    screenshot: screenshotRel,
    instrument: "bench/verify.mjs",
  };

  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(appDir, "verify.json"), JSON.stringify(result, null, 2));

  const widthStr = consoleErrors.length || pageErrors.length || failedRequests.length
    ? " ⚠ see verify.json" : "";
  console.log(`\n${"─".repeat(64)}`);
  console.log(`${slug}  ${allPass ? "✅ PASS" : "❌ FAIL"}  (${result.passCount}/${result.checks.length} checks)${widthStr}`);
  for (const c of result.checks) {
    console.log(`   ${c.pass ? "✓" : "✗"} ${c.name}${c.detail ? " — " + String(c.detail).slice(0, 160) : ""}`);
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});