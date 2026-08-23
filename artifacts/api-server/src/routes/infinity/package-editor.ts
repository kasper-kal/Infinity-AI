import { Router } from "express";
import { readWorkspaceFileText, writeWorkspaceFile } from "../../lib/workspace";
import { cleanText } from "../../lib/text-utils";

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  repository?: string | { type: string; url: string };
  homepage?: string;
  keywords?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: any;
}

const router = Router();

// Parse package.json
async function readPackageJson(workspaceId: string): Promise<PackageJson> {
  try {
    const content = await readWorkspaceFileText("package.json", workspaceId);
    return JSON.parse(content);
  } catch {
    return { name: "my-app", version: "0.0.1" };
  }
}

// Write package.json
async function writePackageJson(workspaceId: string, pkg: PackageJson): Promise<void> {
  const content = JSON.stringify(pkg, null, 2);
  await writeWorkspaceFile("package.json", content, workspaceId);
}

// Get package.json metadata
router.get("/package/metadata", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";

  try {
    const pkg = await readPackageJson(workspaceId);
    res.json({
      ok: true,
      name: pkg.name || "my-app",
      version: pkg.version || "0.0.1",
      description: pkg.description || "",
      author: pkg.author || "",
      license: pkg.license || "MIT",
      homepage: pkg.homepage || "",
      repository: pkg.repository || "",
      keywords: pkg.keywords || [],
    });
  } catch (err) {
    req.log.error({ err }, "Failed to read package.json");
    res.status(500).json({ error: "Failed to read package.json" });
  }
});

// Update basic metadata
router.post("/package/metadata/update", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
  const { name, version, description, author, license, homepage, repository, keywords } = req.body;

  try {
    const pkg = await readPackageJson(workspaceId);

    if (name) pkg.name = cleanText(name, 128);
    if (version) pkg.version = cleanText(version, 64);
    if (description) pkg.description = cleanText(description, 512);
    if (author) pkg.author = cleanText(author, 256);
    if (license) pkg.license = cleanText(license, 64);
    if (homepage) pkg.homepage = cleanText(homepage, 512);
    if (repository) pkg.repository = cleanText(repository, 512);
    if (Array.isArray(keywords)) pkg.keywords = keywords.slice(0, 20).map((k: any) => cleanText(k, 64));

    await writePackageJson(workspaceId, pkg);

    res.json({
      ok: true,
      message: "Package metadata updated",
      package: {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update package metadata");
    res.status(500).json({ error: "Failed to update package metadata" });
  }
});

// Get all scripts
router.get("/package/scripts", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";

  try {
    const pkg = await readPackageJson(workspaceId);
    const scripts = pkg.scripts || {};

    res.json({
      ok: true,
      scripts: Object.entries(scripts).map(([name, command]) => ({
        name,
        command,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to read scripts");
    res.status(500).json({ error: "Failed to read scripts" });
  }
});

// Add or update a script
router.post("/package/scripts/set", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
  const name = cleanText(req.body?.name, 128);
  const command = cleanText(req.body?.command, 512);

  if (!name || !command) {
    return res.status(400).json({ error: "Name and command required" });
  }

  try {
    const pkg = await readPackageJson(workspaceId);
    if (!pkg.scripts) pkg.scripts = {};

    pkg.scripts[name] = command;
    await writePackageJson(workspaceId, pkg);

    return res.json({
      ok: true,
      message: `Script "${name}" set successfully`,
      script: { name, command },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to set script");
    return res.status(500).json({ error: "Failed to set script" });
  }
});

// Delete a script
router.post("/package/scripts/delete", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
  const name = cleanText(req.body?.name, 128);

  if (!name) {
    return res.status(400).json({ error: "Script name required" });
  }

  try {
    const pkg = await readPackageJson(workspaceId);
    if (pkg.scripts && name in pkg.scripts) {
      delete pkg.scripts[name];
      await writePackageJson(workspaceId, pkg);

      return res.json({
        ok: true,
        message: `Script "${name}" deleted`,
      });
    } else {
      return res.status(404).json({ error: "Script not found" });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to delete script");
    return res.status(500).json({ error: "Failed to delete script" });
  }
});

// Get dependencies
router.get("/package/dependencies", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
  const type = cleanText(req.query.type as string, 64) || "all";

  try {
    const pkg = await readPackageJson(workspaceId);

    let dependencies: Record<string, string> = {};
    if (type === "all" || type === "dependencies") {
      dependencies = { ...dependencies, ...pkg.dependencies };
    }
    if (type === "all" || type === "dev") {
      dependencies = { ...dependencies, ...pkg.devDependencies };
    }

    res.json({
      ok: true,
      dependencies: Object.entries(dependencies).map(([name, version]) => ({
        name,
        version,
        isDev: pkg.devDependencies && name in pkg.devDependencies,
      })),
      count: Object.keys(dependencies).length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to read dependencies");
    res.status(500).json({ error: "Failed to read dependencies" });
  }
});

// Get full package.json
router.get("/package/full", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";

  try {
    const pkg = await readPackageJson(workspaceId);
    res.json({ ok: true, package: pkg });
  } catch (err) {
    req.log.error({ err }, "Failed to read package.json");
    res.status(500).json({ error: "Failed to read package.json" });
  }
});

// Generate default package.json template
router.post("/package/initialize", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
  const framework = cleanText(req.body?.framework, 64);
  const name = cleanText(req.body?.name, 128) || "my-app";

  try {
    const templates: Record<string, PackageJson> = {
      nextjs: {
        name,
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "next dev",
          build: "next build",
          start: "next start",
          lint: "next lint",
        },
        dependencies: {
          react: "^18.0.0",
          "react-dom": "^18.0.0",
          next: "^16.0.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
          "@types/react": "^18.0.0",
          "@types/node": "^20.0.0",
        },
      },
      react: {
        name,
        version: "0.1.0",
        scripts: {
          dev: "vite",
          build: "vite build",
          preview: "vite preview",
        },
        dependencies: {
          react: "^18.0.0",
          "react-dom": "^18.0.0",
        },
        devDependencies: {
          vite: "^5.0.0",
          "@vitejs/plugin-react": "^4.0.0",
        },
      },
      node: {
        name,
        version: "1.0.0",
        main: "index.js",
        scripts: {
          start: "node index.js",
          dev: "nodemon index.js",
        },
        dependencies: { express: "^4.18.0" },
        devDependencies: { nodemon: "^3.0.0" },
      },
      default: {
        name,
        version: "0.1.0",
        description: "",
        main: "index.js",
        scripts: {
          test: "echo \"Error: no test specified\" && exit 1",
        },
      },
    };

    const template = templates[framework] || templates.default;
    await writePackageJson(workspaceId, template);

    res.json({
      ok: true,
      message: "package.json initialized",
      package: template,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to initialize package.json");
    res.status(500).json({ error: "Failed to initialize package.json" });
  }
});

export default router;
