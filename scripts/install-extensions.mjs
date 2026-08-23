#!/usr/bin/env node
/**
 * Install unpacked Chrome extensions for infinity-ai's agent browser into
 * ~/.infinity-ai-browser-extensions (auto-loaded on the next server start —
 * no env vars needed).
 *
 * Currently installs: uBlock Origin (ad / tracker / cookie-banner blocker).
 *
 * Usage:
 *   node scripts/install-extensions.mjs
 *   # or set infinity-ai_BROWSER_EXTENSION_DIR to pick a different location
 *
 * Requires: curl-less Node ≥18 (built-in fetch), unzip, and network access to
 * GitHub. Run it on the machine that runs the API server.
 */
import { mkdir, rm, readdir, cp } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createWriteStream, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execSync } from "node:child_process";

const EXT_DIR = process.env.infinity-ai_BROWSER_EXTENSION_DIR || join(homedir(), ".infinity-ai-browser-extensions");

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

/** Latest uBlock Origin chromium zip. Tries the GitHub API, then the releases
 *  Atom feed (no rate limit) as a fallback. */
async function getLatestUBlock() {
  try {
    const relRes = await fetch("https://api.github.com/repos/gorhill/uBlock/releases/latest");
    if (relRes.ok) {
      const rel = await relRes.json();
      const asset = rel.assets?.find((a) => a.name.includes("chromium") && a.name.endsWith(".zip"));
      if (asset) return { tag: rel.tag_name, url: asset.browser_download_url };
    }
  } catch {
    // fall through to Atom feed
  }
  const atomRes = await fetch("https://github.com/gorhill/uBlock/releases.atom");
  if (!atomRes.ok) throw new Error("Could not determine the latest uBlock Origin version");
  const atom = await atomRes.text();
  const m = atom.match(/<entry>[\s\S]*?<title>([^<]+)<\/title>/);
  if (!m) throw new Error("Could not parse the uBlock Origin releases feed");
  const tag = m[1].trim();
  return { tag, url: `https://github.com/gorhill/uBlock/releases/download/${tag}/uBlock0_${tag}.chromium.zip` };
}

function log(title) {
  console.log("");
  console.log(`  ${title}`);
  console.log("  " + "-".repeat(Math.max(10, title.length)));
}

async function main() {
  await mkdir(EXT_DIR, { recursive: true });
  const tmp = await import("node:fs").then(() => execSync("mktemp -d").toString().trim());

  try {
    // ── uBlock Origin ────────────────────────────────────────────────────
    log("uBlock Origin (ad / tracker / cookie-banner blocker)");
    console.log("  fetching latest release info…");
    const { tag, url: uBlockZipUrl } = await getLatestUBlock();
    console.log(`  downloading ${tag}…`);
    const zipPath = join(tmp, "ublock.zip");
    await download(uBlockZipUrl, zipPath);
    execSync(`unzip -q "${zipPath}" -d "${join(tmp, "ublock")}"`);

    // Find the folder that contains manifest.json.
    let src = null;
    const stack = [join(tmp, "ublock")];
    while (stack.length && !src) {
      const dir = stack.pop();
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name === "manifest.json") src = dir;
      }
    }
    if (!src) throw new Error("uBlock manifest.json not found in release zip");

    const dest = join(EXT_DIR, "ublock-origin");
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    await cp(src, dest, { recursive: true });
    console.log(`  ✓ installed ${tag} -> ${dest}`);
  } finally {
    execSync(`rm -rf "${tmp}"`);
  }

  console.log("");
  console.log("Done. Extensions live in:");
  console.log("  " + EXT_DIR);
  console.log("");
  console.log("The agent browser auto-loads every subfolder here on the next server");
  console.log("restart (no env var needed). Override per-run with infinity-ai_BROWSER_EXTENSIONS.");
  console.log("");
  if (!existsSync(EXT_DIR)) {
    console.log("NOTE: nothing was installed (one of the downloads failed). Check network.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nInstall failed: ${err.message}`);
  process.exit(1);
});
