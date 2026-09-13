/**
 * RUNTIME-LEVEL GATE CHECKS — load-test probe, rate-limit scan, PWA infra.
 *
 * Phase 1: previously `load-test`, `rate-limit` and `pwa` returned
 * `not-enforced` ("not implemented"). Now each is a real check or a PROVEN
 * skip — a `skipped` status requires a real predicate:
 *
 *   - load-test: if a runnable service exists (start/serve/dev script), boot
 *     it, wait for a listening port, burst N concurrent requests, then kill the
 *     process group. A service that will not boot FAILS (it could not serve any
 *     load). No runnable entry → skipped (not a server build).
 *   - rate-limit: scan the service's own source for a rate-limiting layer. A
 *     runnable service WITHOUT one fails — an unthrottled API is a defect.
 *   - pwa: if the web build ships PWA infrastructure (manifest and/or service
 *     worker), verify it is complete and valid. If it ships none, it is not a
 *     PWA build → skipped with that predicate — never a forced pass.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import net from "node:net";
import http from "node:http";

export interface BootProbeResult {
  ok: boolean;
  port?: number;
  requests?: number;
  errors?: number;
  p50Ms?: number;
  reason: string;
}

const BOOT_SCRIPTS = ["start", "serve", "dev"];
const COMMON_PORTS = [3000, 4000, 5000, 5173, 8080, 8000, 9000];

/** Name of a runnable-service script if the package has one, else null. */
export function findRunnableScript(pkg: Record<string, unknown>): string | null {
  const scripts = (pkg.scripts as Record<string, unknown> | undefined) ?? {};
  return BOOT_SCRIPTS.find((s) => typeof scripts[s] === "string" && (scripts[s] as string).trim().length > 0) ?? null;
}

/** True the moment a TCP connect on 127.0.0.1:port succeeds. */
function waitListening(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      if (Date.now() > deadline) return resolve(false);
      const sock = net.createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => {
        sock.destroy();
        setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

/** Pull a host:port the service itself printed, if any. */
function portFromOutput(out: string): number | null {
  const url = out.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{2,5})/);
  if (url) return Number(url[1]);
  const phrased = out.match(/[Pp]ort[^\d]{0,12}(\d{2,5})/);
  if (phrased) return Number(phrased[1]);
  return null;
}

async function burstRequests(port: number, n: number, targets: string[]): Promise<{ requests: number; errors: number; p50Ms: number; non200: number }> {
  const latencies: number[] = [];
  let errors = 0;
  let non200 = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < n; i++) {
    workers.push(
      new Promise<void>((resolve) => {
        const start = Date.now();
        const req = http.get({ host: "127.0.0.1", port, path: targets[i % targets.length], timeout: 3000 }, (res) => {
          res.resume();
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 500)) non200++;
          latencies.push(Date.now() - start);
          resolve();
        });
        req.on("timeout", () => { req.destroy(); errors++; resolve(); });
        req.on("error", () => { errors++; resolve(); });
      }),
    );
  }
  await Promise.all(workers);
  latencies.sort((a, b) => a - b);
  const p50 = latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0;
  return { requests: n, errors, p50Ms: p50, non200 };
}

/**
 * Boot a service and hurt it with a modest burst. Kill via the process group
 * (detached leader) so npm + its node child both die; no orphaned servers.
 */
export async function probeServiceBoot(
  projectPath: string,
  startCommand: string,
  opts: { bootTimeoutMs?: number; burst?: number } = {},
): Promise<BootProbeResult> {
  const { bootTimeoutMs = 20_000, burst = 12 } = opts;
  const { execa } = await import("execa");

  const child = execa(startCommand, {
    cwd: projectPath,
    shell: true,
    detached: true,
    reject: false,
    env: { ...process.env },
  });
  let outTail = "";
  child.stdout?.on("data", (c: Buffer) => { outTail = (outTail + String(c)).slice(-3000); });
  child.stderr?.on("data", (c: Buffer) => { outTail = (outTail + String(c)).slice(-3000); });
  const stop = () => { try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill().catch(() => {}); } catch { /* already dead */ } } };

  const startedAt = Date.now();
  let port: number | null = null;
  while (Date.now() - startedAt < bootTimeoutMs) {
    for (const p of COMMON_PORTS) {
      if (await waitListening(p, 700)) { port = p; break; }
    }
    if (port === null) port = portFromOutput(outTail);
    if (port !== null) break;
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  if (port !== null) {
    const r = await burstRequests(port, burst, ["/health", "/"]);
    stop();
    const edge = r.non200 > 0 || r.errors > 0;
    return {
      ok: !edge,
      port,
      requests: r.requests,
      errors: r.errors,
      p50Ms: r.p50Ms,
      reason: edge
        ? `${r.errors} error(s) + ${r.non200} non-2xx among ${r.requests} requests`
        : `${r.requests} requests, p50 ${r.p50Ms}ms, no errors`,
    };
  }

  if (child.exitCode === null) {
    stop();
    return { ok: false, reason: `service never listened on any port within ${bootTimeoutMs}ms: ${outTail.slice(0, 200)}` };
  }
  return { ok: false, reason: `service exited (code ${child.exitCode}) before listening: ${outTail.slice(0, 200)}` };
}

// ————————————————————————————————————————————————————————————————————————
// Rate-limit scan
// ————————————————————————————————————————————————————————————————————————

export interface RateLimitScan {
  entryFound: boolean;
  matched: Array<{ file: string; pattern: string }>;
}

const RATE_LIMIT_PATTERNS = [
  "express-rate-limit",
  "rateLimit(",
  "rate-limiter",
  "rate-limit-flexible",
  "nestjs/throttler",
  "ThrottlerGuard",
  "@upstash/ratelimit",
  "RateLimiter",
  "hono-rate-limiter",
];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".next", ".vercel", "public"]);

/** Scan a project's OWN source for a rate-limiting layer (skips vendored dirs). */
export async function detectRateLimitUsage(projectPath: string): Promise<RateLimitScan> {
  let entryFound = false;
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(projectPath, "package.json"), "utf-8"));
    entryFound = findRunnableScript(pkg) !== null;
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const name of Object.keys(deps)) {
      if (["express-rate-limit", "rate-limiter-flexible", "@nestjs/throttler", "@upstash/ratelimit", "hono-rate-limiter"].includes(name)) {
        return { entryFound, matched: [{ file: "package.json", pattern: name }] };
      }
    }
  } catch {
    // not a JS package — no entry, scan nothing
  }

  const matched: Array<{ file: string; pattern: string }> = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4 || matched.length > 10) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        await walk(path.join(dir, ent.name), depth + 1);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ent.name)) {
        const full = path.join(dir, ent.name);
        let content = "";
        try { content = await fs.readFile(full, "utf-8"); } catch { continue; }
        if (content.length > 512 * 1024) continue;
        for (const pattern of RATE_LIMIT_PATTERNS) {
          if (content.includes(pattern)) {
            matched.push({ file: path.relative(projectPath, full), pattern });
            break;
          }
        }
      }
    }
  };
  await walk(projectPath, 0);
  return { entryFound, matched };
}

// ————————————————————————————————————————————————————————————————————————
// PWA infrastructure detection
// ————————————————————————————————————————————————————————————————————————

export interface PwaInfra {
  webOutput: boolean;
  manifest: { present: boolean; valid: boolean; file?: string };
  serviceWorker: { present: boolean; file?: string };
  hasAny: boolean;
}

const MANIFEST_FILES = ["manifest.json", "manifest.webmanifest", "site.webmanifest", "app.webmanifest"];

async function fileAtCandidates(projectPath: string, names: string[], baseDirs: string[]): Promise<string | null> {
  for (const base of baseDirs) {
    for (const name of names) {
      const full = path.join(projectPath, base, name);
      try {
        const stat = await fs.stat(full);
        if (stat.isFile()) return path.join(base, name);
      } catch { /* not here */ }
    }
  }
  return null;
}

function swInHtml(html: string): boolean {
  return /serviceWorker\.register|<script[^>]*src=["'][^"']*(sw|service-worker)[^"']*\.js/i.test(html);
}

/** Detect whether the built app ships PWA infra and whether it is complete. */
export async function detectPwaInfra(projectPath: string): Promise<PwaInfra> {
  const baseDirs = ["", "public", "static", "assets"];
  const index = await fileAtCandidates(projectPath, ["index.html"], baseDirs);
  if (!index) return { webOutput: false, manifest: { present: false, valid: false }, serviceWorker: { present: false }, hasAny: false };

  let html = "";
  try { html = await fs.readFile(path.join(projectPath, index), "utf-8"); } catch { html = ""; }

  // Manifest present via file OR link rel=manifest in index.html.
  let manifestFile = await fileAtCandidates(projectPath, MANIFEST_FILES, baseDirs);
  if (!manifestFile) {
    const m = html.match(/<link[^>]*rel=["']manifest["'][^>]*href=["']([^"']+)["']/i);
    if (m && !m[1].startsWith("http")) {
      const resolved = m[1].replace(/^\.?\//, "");
      if (await fs.stat(path.join(projectPath, resolved)).then(() => true).catch(() => false)) {
        manifestFile = resolved;
      }
    }
  }

  let manifestValid = false;
  if (manifestFile) {
    try {
      const raw = await fs.readFile(path.join(projectPath, manifestFile), "utf-8");
      const parsed = JSON.parse(raw);
      manifestValid = Boolean(parsed && typeof parsed.name === "string" && typeof parsed.start_url === "string" && typeof parsed.display === "string");
    } catch { manifestValid = false; }
  }

  // Service worker present via a *sw*.js file or a registration call.
  let swFile = await fileAtCandidates(projectPath, ["sw.js", "service-worker.js", "serviceworker.js", "custom-sw.js"], baseDirs);
  if (!swFile) {
    const reg = html.match(/navigator\.serviceWorker\.register\(["']([^"']+)["']/);
    if (reg) {
      const resolved = reg[1].replace(/^\.?\//, "");
      if (await fs.stat(path.join(projectPath, resolved)).then(() => true).catch(() => false)) {
        swFile = resolved;
      }
    }
  }

  return {
    webOutput: true,
    manifest: { present: Boolean(manifestFile), valid: manifestValid, file: manifestFile ?? undefined },
    serviceWorker: { present: Boolean(swFile) || swInHtml(html), file: swFile ?? undefined },
    hasAny: Boolean(manifestFile) || Boolean(swFile) || swInHtml(html),
  };
}