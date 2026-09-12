#!/usr/bin/env node
/**
 * bench/cleanup.mjs — handle leftover state from prior LLM agent runs.
 *
 * Single-project regression guard: after a botched/aborted run a workspace may
 * still hold stale Infinity checkpoints, a half-finished `node_modules`, git
 * state, or orphan screenshots that make the next run's verdict a lie. This
 * resets an app to a known-clean base so re-runs measure a fresh build.
 *
 *   node bench/cleanup.mjs                 # clean ALL bench apps (default)
 *   node bench/cleanup.mjs --app todo      # one app
 *   node bench/cleanup.mjs --keep-apps     # wipe build/verify artifacts only
 *   node bench/cleanup.mjs --out out       # scope to an output root
 *
 * Kills: dist/, node_modules/.cache, verify.json, screenshot.png, stale
 * `*.infinity` markers, leftover `.git` inside an app, and any lock files.
 * Keeps: source files (so a re-run can just rebuild).
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPS } from "./driver.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname);
const OUT = join(ROOT, "out");

const WIPE_PATTERNS = [
  "dist", "build", "node_modules/.cache", "*.infinity", ".infinity", "*.lock",
  "package-lock.json", "pnpm-lock.yaml", ".git",
];
const WIPE_FILES = ["verify.json", "screenshot.png", "verify.spec.html", "last-run.log"];

async function wipe(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const p of WIPE_FILES) {
    const f = join(dir, p);
    if (existsSync(f)) { await fs.rm(f, { recursive: true, force: true }); count++; }
  }
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  await fs.rm(join(dir, "node_modules"), { recursive: true, force: true }).catch(() => {});
  for (const ent of entries) {
    const matches = WIPE_PATTERNS.some((pat) => ent.name.replace(/\*/g, "").endsWith(pat.replace(/^\*/, "")) || pat === ent.name);
    if (matches && ent.name !== "node_modules") {
      await fs.rm(join(dir, ent.name), { recursive: true, force: true }).catch(() => {});
      count++;
    }
  }
  return count;
}

async function main() {
  const args = process.argv.slice(2);
  const app = args.includes("--app") ? args[args.indexOf("--app") + 1] : null;
  const outDir = args.includes("--out") ? resolve(ROOT, args[args.indexOf("--out") + 1]) : OUT;
  const targets = app ? APPS.filter((x) => x.slug === app) : APPS;
  if (app && !targets.length) { console.error(`unknown app '${app}'`); process.exit(2); }

  let total = 0;
  for (const a of targets) {
    const dir = join(outDir, a.slug);
    const wiped = await wipe(dir);
    console.log(`${wiped ? `🧹 ${a.slug}: removed ${wiped} artifact(s)` : `· ${a.slug}: clean already`}`);
    total += wiped;
  }
  console.log(`\nCleanup done — ${total} artifact(s) removed. Source files preserved.`);
}

main().catch((e) => { console.error(e); process.exit(2); });