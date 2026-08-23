import { Router } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runTerminalCommand, getWorkspaceRoot, listWorkspaceFiles, readWorkspaceFile } from "../../lib/workspace";

const router = Router();

interface PackageMetadata {
  name: string;
  version: string;
  description?: string;
  downloads?: number;
  url?: string;
}

interface PackageManagerInfo {
  type: "npm" | "pip" | "cargo" | "go" | "composer" | "gem" | "maven" | "gradle";
  manifestFile: string;
  installCommand: (pkg: string, version?: string) => string;
  uninstallCommand: (pkg: string) => string;
  listCommand: string;
  searchUrl?: (pkg: string) => string;
}

const PACKAGE_MANAGERS: Record<string, PackageManagerInfo> = {
  npm: {
    type: "npm",
    manifestFile: "package.json",
    installCommand: (pkg: string, version?: string) => `npm install ${version ? `${pkg}@${version}` : pkg}`,
    uninstallCommand: (pkg: string) => `npm uninstall ${pkg}`,
    listCommand: "npm list --depth=0",
    searchUrl: (pkg: string) => `https://registry.npmjs.org/-/search?text=${encodeURIComponent(pkg)}&size=20`,
  },
  pip: {
    type: "pip",
    manifestFile: "requirements.txt",
    installCommand: (pkg: string, version?: string) => `pip install ${version ? `${pkg}==${version}` : pkg}`,
    uninstallCommand: (pkg: string) => `pip uninstall ${pkg} -y`,
    listCommand: "pip list",
    searchUrl: (pkg: string) => `https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`,
  },
  cargo: {
    type: "cargo",
    manifestFile: "Cargo.toml",
    installCommand: (pkg: string, version?: string) => `cargo add ${version ? `${pkg}@${version}` : pkg}`,
    uninstallCommand: (pkg: string) => `cargo remove ${pkg}`,
    listCommand: "cargo tree --depth=0",
    searchUrl: (pkg: string) => `https://crates.io/api/v1/crates?q=${encodeURIComponent(pkg)}&per_page=20`,
  },
  go: {
    type: "go",
    manifestFile: "go.mod",
    installCommand: (pkg: string) => `go get ${pkg}`,
    uninstallCommand: (pkg: string) => `go get ${pkg}@none`,
    listCommand: "go list -m all",
  },
  composer: {
    type: "composer",
    manifestFile: "composer.json",
    installCommand: (pkg: string, version?: string) => `composer require ${version ? `"${pkg}:${version}"` : pkg}`,
    uninstallCommand: (pkg: string) => `composer remove ${pkg}`,
    listCommand: "composer show",
    searchUrl: (pkg: string) => `https://packagist.org/search.json?q=${encodeURIComponent(pkg)}`,
  },
  gem: {
    type: "gem",
    manifestFile: "Gemfile",
    installCommand: (pkg: string, version?: string) => `gem install ${version ? `${pkg} -v ${version}` : pkg}`,
    uninstallCommand: (pkg: string) => `gem uninstall ${pkg}`,
    listCommand: "gem list",
    searchUrl: (pkg: string) => `https://rubygems.org/api/v1/search.json?query=${encodeURIComponent(pkg)}`,
  },
};

/**
 * Detect package manager from workspace files.
 */
async function detectPackageManager(
  workspaceId: string,
): Promise<{ manager: PackageManagerInfo; type: string } | null> {
  const entries = await listWorkspaceFiles(workspaceId);
  const files = entries.map((e) => e.path);

  for (const [key, manager] of Object.entries(PACKAGE_MANAGERS)) {
    if (files.includes(manager.manifestFile)) {
      return { manager, type: key };
    }
  }
  return null;
}

/**
 * Parse installed packages from manifest or list command.
 */
async function getInstalledPackages(
  workspaceId: string,
  managerType: string,
): Promise<{ name: string; version: string }[]> {
  const manager = PACKAGE_MANAGERS[managerType];
  if (!manager) return [];

  try {
    const result = await runTerminalCommand("default", manager.listCommand, { workspaceId });
    const lines = result.stdout.split("\n");
    const packages: { name: string; version: string }[] = [];

    if (managerType === "npm") {
      for (const line of lines) {
        const match = line.match(/^\s+(\S+)\s+(\d+\.\d+\.\d+)/);
        if (match) {
          packages.push({ name: match[1], version: match[2] });
        }
      }
    } else if (managerType === "pip") {
      for (const line of lines) {
        const match = line.match(/^(\S+)\s+(\d+\.\d+\.\d+)/);
        if (match) {
          packages.push({ name: match[1], version: match[2] });
        }
      }
    } else if (managerType === "cargo") {
      for (const line of lines) {
        const match = line.match(/^\s*(\S+)\s+v?(\d+\.\d+\.\d+)/);
        if (match) {
          packages.push({ name: match[1], version: match[2] });
        }
      }
    }

    return packages;
  } catch {
    return [];
  }
}

/**
 * Search for packages on public registries.
 */
async function searchPackages(managerType: string, query: string): Promise<PackageMetadata[]> {
  const manager = PACKAGE_MANAGERS[managerType];
  if (!manager?.searchUrl) return [];

  try {
    const url = manager.searchUrl(query);
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await response.json() as unknown;

    // Handle different registry response formats
    if (managerType === "npm" && data && typeof data === "object" && "objects" in data) {
      return (data.objects as Array<{ package?: { name?: string; version?: string; description?: string; links?: { npm?: string } } }>)
        .slice(0, 20)
        .map((item) => ({
          name: item.package?.name || "",
          version: item.package?.version || "",
          description: item.package?.description,
          url: item.package?.links?.npm,
        }))
        .filter((pkg) => pkg.name);
    } else if (managerType === "pip" && data && typeof data === "object" && "releases" in data) {
      const obj = data as { releases?: Record<string, Array<unknown>>; info?: { name?: string; summary?: string; home_page?: string } };
      const releases = obj.releases || {};
      const latestVersion = Object.keys(releases).sort().pop() || "";
      return [
        {
          name: obj.info?.name || query,
          version: latestVersion,
          description: obj.info?.summary,
          url: obj.info?.home_page,
        },
      ];
    } else if (managerType === "cargo" && data && typeof data === "object" && "crates" in data) {
      return (data.crates as Array<{ name?: string; max_version?: string; documentation?: string }>)
        .slice(0, 20)
        .map((item) => ({
          name: item.name || "",
          version: item.max_version || "",
          url: item.documentation,
        }))
        .filter((pkg) => pkg.name);
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * List installed packages.
 */
router.get("/packages", async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "default";

  try {
    const detected = await detectPackageManager(workspaceId);
    if (!detected) {
      res.json({ packages: [], manager: null });
      return;
    }

    const packages = await getInstalledPackages(workspaceId, detected.type);
    res.json({ packages, manager: detected.type, manifestFile: detected.manager.manifestFile });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list packages" });
  }
});

/**
 * Search for packages.
 */
router.get("/packages/search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q : "";
  const managerType = typeof req.query.manager === "string" ? req.query.manager : "npm";

  if (!query.trim()) {
    res.status(400).json({ error: "Search query is required" });
    return;
  }

  try {
    const results = await searchPackages(managerType, query.slice(0, 100));
    res.json({ query, manager: managerType, results: results.slice(0, 20) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Search failed" });
  }
});

/**
 * Install a package.
 */
router.post("/packages/install", async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "default";
  const packageName = typeof req.body?.package === "string" ? req.body.package : "";
  const version = typeof req.body?.version === "string" ? req.body.version : undefined;
  const managerType = typeof req.body?.manager === "string" ? req.body.manager : "npm";

  if (!packageName.trim()) {
    res.status(400).json({ error: "Package name is required" });
    return;
  }

  const manager = PACKAGE_MANAGERS[managerType];
  if (!manager) {
    res.status(400).json({ error: `Unknown package manager: ${managerType}` });
    return;
  }

  try {
    const command = manager.installCommand(packageName.slice(0, 100), version?.slice(0, 50));
    const result = await runTerminalCommand("default", command, { workspaceId, timeoutMs: 60000 });

    if (result.exitCode !== 0) {
      res.status(400).json({ error: result.stderr || "Installation failed" });
    } else {
      res.json({
        ok: true,
        package: packageName,
        version,
        manager: managerType,
        output: result.stdout.slice(-500),
      });
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Installation failed" });
  }
});

/**
 * Uninstall a package.
 */
router.post("/packages/uninstall", async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "default";
  const packageName = typeof req.body?.package === "string" ? req.body.package : "";
  const managerType = typeof req.body?.manager === "string" ? req.body.manager : "npm";

  if (!packageName.trim()) {
    res.status(400).json({ error: "Package name is required" });
    return;
  }

  const manager = PACKAGE_MANAGERS[managerType];
  if (!manager) {
    res.status(400).json({ error: `Unknown package manager: ${managerType}` });
    return;
  }

  try {
    const command = manager.uninstallCommand(packageName.slice(0, 100));
    const result = await runTerminalCommand("default", command, { workspaceId, timeoutMs: 30000 });

    if (result.exitCode !== 0) {
      res.status(400).json({ error: result.stderr || "Uninstall failed" });
    } else {
      res.json({
        ok: true,
        package: packageName,
        manager: managerType,
        output: result.stdout.slice(-500),
      });
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Uninstall failed" });
  }
});

export default router;
export { detectPackageManager, getInstalledPackages, searchPackages };
