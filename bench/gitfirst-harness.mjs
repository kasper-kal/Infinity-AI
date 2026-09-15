#!/usr/bin/env node
/**
 * bench/gitfirst-harness.mjs — FIX-plan Phase 6 acceptance: prove GIT-FIRST
 * BUILDS with the REAL module (`lib/git-first-builds.ts`) against REAL git
 * repos. No DB, no network — pure git mechanics on real temp repositories.
 *
 * What this proves (mapped to the Phase 6 spec — "worktree per build ·
 * incremental commits · final diff · success → keep branch · failure →
 * auto-revert"):
 *   S1. BRANCH ISOLATION — beginGitFirstBuild starts on `infinity/build/<id>`;
 *       the base branch's HEAD does NOT move when the build commits.
 *   S2. INCREMENTAL COMMITS — commitGitFirstStep produces real commits (40-char
 *       hash, real filesChanged, insertions/deletions) per step; base branch
 *       stays untouched across the whole build.
 *   S3. LIVE STATUS — getGitFirstStatus reports active/branch/dirty honestly.
 *   S4. FAILURE → AUTO-REVERT — revertGitFirstBuild returns the working tree to
 *       the EXACT pre-build base state (build files gone, base file present,
 *       on the base branch, state cleared) while the build branch object stays
 *       in the repo for inspection.
 *   S5. SUCCESS → KEEP — finalizeGitFirstBuild squash-merges the build branch
 *       into the base branch (the base branch then contains the build's files),
 *       retains the branch object, and clears the state file.
 *   S6. FINAL DIFF — generateGitFirstDiffSummary returns base..head file list +
 *       insertions/deletions + diffStat + commit count.
 *   S7. RESUME ACROSS A "KILL" — calling beginGitFirstBuild again (simulating
 *       the process being killed and restarted) resumes the SAME buildId/branch
 *       and further step commits accumulate, base unchanged.
 *   S8. EMPTY-REPO + NO-GIT HONESTY — a git-init'd empty repo gets a base
 *       commit so revert has a target; a non-repo path returns {ok:false}
 *       (graceful degradation, never throws).
 *
 * Honest limit (asserted as such, never faked): the isolation is BRANCH
 * isolation in the project's own repo (documented deviation in PHASES.md), not
 * a separate `git worktree` working directory — no live path writes there.
 *
 * Exit code: 0 when every check passes; 1 otherwise.
 */
import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const API_SERVER = join(ROOT, "artifacts", "api-server");
const BUNDLE_FILE = join(API_SERVER, ".gitfirst-harness-bundle.mjs");
const require = createRequire(join(API_SERVER, "package.json"));

const API = (p) => resolve(API_SERVER, "src", p).replace(/\\/g, "/");

const ENTRY = `
import { promises as fsp } from "node:fs";
import * as fss from "node:fs";
import * as fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  beginGitFirstBuild,
  commitGitFirstStep,
  revertGitFirstBuild,
  finalizeGitFirstBuild,
  generateGitFirstDiffSummary,
  getGitFirstStatus,
} from "${API("lib/git-first-builds.ts")}";

let allPass = true;
const pass = (label) => console.log("✅  " + label);
const fail = (label, detail) => { console.error("❌  " + label + (detail ? " — " + detail : "")); allPass = false; };
const assert = (cond, label, detail) => (cond ? pass(label) : fail(label, detail));

const TMP_BASE = fsSync.mkdtempSync(path.join(os.tmpdir(), "gitfirst-"));
const cleanups = [];
const tmpRepo = (name) => {
  const dir = path.join(TMP_BASE, name);
  fsSync.mkdirSync(dir, { recursive: true });
  cleanups.push(() => fsSync.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// Seed a REAL git repo: init + identity + a committed base file.
function seedRepo(name, baseFiles = {}) {
  const dir = tmpRepo(name);
  execSync("git init -q", { cwd: dir });
  execSync("git config user.name harness", { cwd: dir });
  execSync("git config user.email harness@bench.local", { cwd: dir });
  for (const [file, content] of Object.entries(baseFiles)) {
    fsSync.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    fsSync.writeFileSync(path.join(dir, file), content, "utf8");
  }
  execSync("git add -A", { cwd: dir });
  execSync("git commit -q -m 'seed'", { cwd: dir });
  return dir;
}
const branchOf = (dir) => execSync("git symbolic-ref --short HEAD", { cwd: dir }).toString().trim();
const headOf = (dir, ref = "HEAD") => execSync(\`git rev-parse \${ref}\`, { cwd: dir }).toString().trim();
const baseHead = (b) => { try { return headOf(b); } catch { return ""; } };

async function main() {
  console.log("GITFIRST HARNESS — Phase 6: Git-First Builds");

  // ============================================================
  // S1. BRANCH ISOLATION + base commitment
  // ============================================================
  console.log("\\n=== S1. BRANCH ISOLATION ===");
  {
    const dir = seedRepo("s1", { "base.txt": "stable\\n" });
    const baseBefore = headOf(dir);
    const r = await beginGitFirstBuild(dir);
    assert(r.ok === true, "beginGitFirstBuild on a real repo returns ok", r.reason);
    assert(typeof r.session?.branch === "string" && r.session.branch.startsWith("infinity/build/"), "session branch = infinity/build/<id>", r.session?.branch);
    assert(branchOf(dir) === r.session?.branch, "HEAD is on the build branch");
    assert(r.session.baseCommit === baseBefore, "baseCommit == pre-build HEAD (unchanged)", r.session?.baseCommit?.slice(0, 8) + " vs " + baseBefore.slice(0, 8));
    assert(fss.readFileSync(path.join(dir, "base.txt"), "utf8") === "stable\\n", "working tree still has the base file");
  }

  // ============================================================
  // S2. INCREMENTAL COMMITS (real), base branch untouched
  // ============================================================
  console.log("\\n=== S2. INCREMENTAL COMMITS ===");
  {
    const dir = seedRepo("s2", { "base.txt": "stable\\n" });
    const baseBefore = headOf(dir);
    const s = (await beginGitFirstBuild(dir)).session;
    fsSync.writeFileSync(path.join(dir, "a.txt"), "aaa\\n", "utf8");
    const c1 = await commitGitFirstStep(dir, 1, 2, "step one");
    assert(c1 !== null, "step 1 commit created");
    assert(/^[0-9a-f]{40}$/.test(c1?.commitHash ?? ""), "commit 1 has a real 40-char hash", c1?.commitHash);
    assert(c1?.filesChanged?.includes("a.txt"), "commit 1 filesChanged lists a.txt", JSON.stringify(c1?.filesChanged));
    assert(c1?.filesChanged?.includes("base.txt") === false, "base.txt (already committed) not re-listed");
    fsSync.writeFileSync(path.join(dir, "b.txt"), "bbb\\n", "utf8");
    const c2 = await commitGitFirstStep(dir, 2, 2, "step two");
    assert(c2 !== null && c2.message === "step two", "step 2 commit has its message", c2?.message);
    assert(headOf(dir) === c2?.commitHash, "HEAD == step 2 commit hash");
    const log = execSync(\`git log --oneline \${s.baseBranch}..HEAD\`, { cwd: dir }).toString().trim().split("\\n");
    assert(log.filter(Boolean).length === 2, "exactly 2 build commits on the build branch", JSON.stringify(log));
    assert(headOf(dir, s.baseBranch) === baseBefore, "BASE BRANCH HEAD UNCHANGED after builds (isolation)", headOf(dir, s.baseBranch).slice(0, 8));
  }

  // ============================================================
  // S3. LIVE STATUS
  // ============================================================
  console.log("\\n=== S3. LIVE STATUS ===");
  {
    const dir = seedRepo("s3", { "base.txt": "x\\n" });
    const before = await getGitFirstStatus(dir);
    assert(before && before.active === false, "no state → inactive before begin");
    await beginGitFirstBuild(dir);
    fsSync.writeFileSync(path.join(dir, "dirty.txt"), "d\\n", "utf8");
    const mid = await getGitFirstStatus(dir);
    assert(mid?.active === true && mid?.branch?.startsWith("infinity/build/"), "active + branch after begin");
    assert(mid?.dirty === 1, "dirty count reflects the uncommitted file", String(mid?.dirty));
    assert(mid?.currentBranch === mid?.branch, "currentBranch is the build branch");
  }

  // ============================================================
  // S4. FAILURE → AUTO-REVERT
  // ============================================================
  console.log("\\n=== S4. FAILURE AUTO-REVERT ===");
  {
    const dir = seedRepo("s4", { "base.txt": "stable\\n" });
    const baseBefore = headOf(dir);
    const s = (await beginGitFirstBuild(dir)).session;
    fsSync.writeFileSync(path.join(dir, "a.txt"), "aaa\\n", "utf8");
    await commitGitFirstStep(dir, 1, 1, "the failing build's step");
    const rv = await revertGitFirstBuild(dir);
    assert(rv.success === true, "revertGitFirstBuild succeeds");
    assert(branchOf(dir) === s.baseBranch, "after revert HEAD is back on the base branch", branchOf(dir));
    assert(headOf(dir) === baseBefore, "after revert HEAD == pre-build base commit");
    assert(fss.existsSync(path.join(dir, "a.txt")) === false, "build file a.txt is GONE from the working tree");
    assert(fss.existsSync(path.join(dir, "base.txt")) === true, "base file is present");
    const branchRefs = execSync("git for-each-ref --format='%(refname)' refs/heads/infinity/build/", { cwd: dir }).toString().trim().split("\\n").filter(Boolean);
    assert(branchRefs.some((r) => r.endsWith(s.branch)), "build branch OBJECT is retained for inspection", JSON.stringify(branchRefs));
    assert(fss.existsSync(path.join(dir, ".infinity", "git-first-state.json")) === false, "state file cleared so the next build starts fresh");
  }

  // ============================================================
  // S5. SUCCESS → KEEP (squash-merge into base branch)
  // ============================================================
  console.log("\\n=== S5. SUCCESS KEEP ===");
  {
    const dir = seedRepo("s5", { "base.txt": "stable\\n" });
    const baseBefore = headOf(dir);
    const s = (await beginGitFirstBuild(dir)).session;
    fsSync.writeFileSync(path.join(dir, "app.txt"), "app\\n", "utf8");
    await commitGitFirstStep(dir, 1, 1, "build app");
    const fin = await finalizeGitFirstBuild(dir);
    assert(fin.success === true, "finalize succeeds", fin.message);
    assert(typeof fin.mergeCommit === "string" && fin.mergeCommit.length === 40, "keep produced a real merge commit", fin.mergeCommit);
    assert(branchOf(dir) === s.baseBranch, "after keep HEAD is on the base branch");
    const appOnBase = execSync(\`git cat-file -e \${s.baseBranch}:app.txt && echo yes || echo no\`, { cwd: dir }).toString().trim();
    assert(appOnBase === "yes", "the build's app.txt is ON the base branch (keep = merged)", appOnBase);
    assert(headOf(dir, s.baseBranch) !== baseBefore, "base branch advanced with the kept build");
    const retained = execSync(\`git for-each-ref --format='%(refname)' refs/heads/infinity/build/\`, { cwd: dir }).toString().trim();
    assert(retained.includes(s.branch), "build branch object retains the record after keep");
    assert(fss.existsSync(path.join(dir, ".infinity", "git-first-state.json")) === false, "state file cleared after keep");
  }

  // ============================================================
  // S6. FINAL DIFF SUMMARY
  // ============================================================
  console.log("\\n=== S6. FINAL DIFF ===");
  {
    const dir = seedRepo("s6", { "base.txt": "stable\\n" });
    const s = (await beginGitFirstBuild(dir)).session;
    fsSync.writeFileSync(path.join(dir, "feature.ts"), "export const x = 1;\\nline2\\nline3\\n", "utf8");
    await commitGitFirstStep(dir, 1, 1, "feature");
    const d = await generateGitFirstDiffSummary(dir);
    assert(d !== null, "diff summary generated (before finalize, while on build branch)");
    assert(d?.buildId === s.buildId && d?.branch === s.branch, "summary matches the session", d?.buildId + " / " + d?.branch);
    assert(d?.filesChanged?.includes("feature.ts"), "summary lists feature.ts", JSON.stringify(d?.filesChanged));
    assert((d?.totalInsertions ?? 0) > 0, "insertions counted (" + d?.totalInsertions + ")", d?.diffStat?.split("\\n")?.filter(Boolean)?.join(" | "));
    assert((d?.totalCommits ?? 0) >= 1, "commit count ≥ 1", String(d?.totalCommits));
    assert(typeof d?.diffStat === "string" && d.diffStat.includes("feature.ts"), "diffStat text present");
    // after finalize, the base..base-after-merge diff collapses to the same files (no double spacing)
    const fin = await finalizeGitFirstBuild(dir);
    assert(fin.success === true, "keep also succeeds after diff generation");
  }

  // ============================================================
  // S7. RESUME across a "kill"
  // ============================================================
  console.log("\\n=== S7. RESUME ACROSS A KILL ===");
  {
    const dir = seedRepo("s7", { "base.txt": "x\\n" });
    const baseBefore = headOf(dir);
    const s1 = (await beginGitFirstBuild(dir)).session;
    fsSync.writeFileSync(path.join(dir, "one.txt"), "1\\n", "utf8");
    await commitGitFirstStep(dir, 1, 3, "first lifetime");
    // simulate the process dying and restarting: new begin call on same repo
    const s2 = (await beginGitFirstBuild(dir)).session;
    assert(s2?.resumed === true, "second begin reports RESUMED", String(s2?.resumed));
    assert(s2?.buildId === s1?.buildId && s2?.branch === s1?.branch, "resume reuses the SAME buildId + branch", s2?.branch + " vs " + s1?.branch);
    assert(s2?.baseCommit === s1?.baseCommit, "resume keeps the original base commit", s2?.baseCommit?.slice(0, 8));
    fsSync.writeFileSync(path.join(dir, "two.txt"), "2\\n", "utf8");
    await commitGitFirstStep(dir, 2, 3, "second lifetime");
    const log = execSync("git log --oneline --max-count=3", { cwd: dir }).toString().trim().split("\\n");
    assert(log[0].includes("step 2/3") && log[1].includes("step 1/3"), "step commits accumulated on the SAME branch across the kill", log.join(" | "));
    assert(headOf(dir, s2.baseBranch) === baseBefore, "base branch untouched through the kill");
  }

  // ============================================================
  // S8. EMPTY-REPO BASE + NO-GIT HONESTY
  // ============================================================
  console.log("\\n=== S8. EMPTY-REPO + NO-GIT HONESTY ===");
  {
    const dir = tmpRepo("s8-empty");
    execSync("git init -q", { cwd: dir });
    const r = await beginGitFirstBuild(dir);
    assert(r.ok === true, "begin on a git-init'd EMPTY repo still works (base commit created)", r.reason);
    assert(typeof r.session?.baseCommit === "string" && r.session.baseCommit.length === 40, "empty repo got a real base commit", r.session?.baseCommit);
  }
  {
    const dir = tmpRepo("s8-nogit"); // never git-inited
    let threw = false; let r;
    try { r = await beginGitFirstBuild(dir); } catch { threw = true; }
    assert(threw === false, "begin on a NON-repo never throws");
    assert(r && r.ok === false && String(r.reason).includes("not-a-git-repo"), "begin on a NON-repo returns {ok:false, reason:'not-a-git-repo'}", r?.reason);
    const rv = await revertGitFirstBuild(dir);
    assert(rv.success === false, "revert on a NON-repo returns success:false (honest no-op)");
  }

  // ============================================================
  // verdict
  // ============================================================
  cleanups.forEach((fn) => { try { fn(); } catch {} });
  console.log("");
  console.log(allPass ? "GITFIRST_HARNESS_OK" : "GITFIRST_HARNESS_FAILED");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("gitfirst-harness bundle:", err);
  process.exit(1);
});
`;

async function main() {
  const esbuild = require("esbuild");
  await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: API_SERVER, sourcefile: "gitfirst-harness-entry.ts", loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: BUNDLE_FILE,
    logLevel: "warning",
    external: [],
    banner: {
      js: `import { createRequire as __cr } from "node:module";\nimport * as __bannerPath from "node:path";\nimport { fileURLToPath as __bannerFileURLToPath } from "node:url";\nglobalThis.require = __cr(${JSON.stringify(join(API_SERVER, "package.json"))});\nglobalThis.__filename = __bannerFileURLToPath(import.meta.url);\nglobalThis.__dirname = __bannerPath.dirname(globalThis.__filename);`,
    },
  });

  const env = { ...process.env, NODE_ENV: "production" };
  const run = spawnSync(process.execPath, [BUNDLE_FILE], { env, stdio: "inherit", cwd: ROOT, timeout: 120_000 });
  process.exit(run.status ?? 1);
}

main().catch((err) => {
  console.error("gitfirst-harness failed:", err);
  process.exit(1);
});