import { Router } from "express";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";

const router = Router();

interface Endpoint {
  method: string;
  path: string;
  description?: string;
  parameters?: Record<string, string>;
  requestBody?: Record<string, unknown>;
  responseExample?: Record<string, unknown>;
}

interface APISpec {
  framework: string;
  language: string;
  endpoints: Endpoint[];
  baseUrl: string;
  documentation?: string;
}

/**
 * Detect API framework from workspace files
 */
async function detectAPIFramework(workspaceId: string): Promise<string | null> {
  const workspacePath = path.join("/tmp/workspaces", workspaceId);

  try {
    const entries = await fs.readdir(workspacePath);

    // Express/Node.js
    if (entries.includes("package.json")) {
      const pkgJson = JSON.parse(await fs.readFile(path.join(workspacePath, "package.json"), "utf-8"));
      const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

      if (deps.express) return "express";
      if (deps.fastify) return "fastify";
      if (deps.hono) return "hono";
      if (deps.next) return "nextjs";
      if (deps.nuxt) return "nuxt";
    }

    // Python
    if (entries.includes("requirements.txt")) {
      const reqsContent = await fs.readFile(path.join(workspacePath, "requirements.txt"), "utf-8");
      if (reqsContent.includes("flask")) return "flask";
      if (reqsContent.includes("fastapi")) return "fastapi";
      if (reqsContent.includes("django")) return "django";
    }

    // Go
    if (entries.includes("go.mod")) {
      const goModContent = await fs.readFile(path.join(workspacePath, "go.mod"), "utf-8");
      if (goModContent.includes("gin")) return "gin";
      if (goModContent.includes("echo")) return "echo";
      if (goModContent.includes("fiber")) return "fiber";
    }

    // Rust
    if (entries.includes("Cargo.toml")) {
      const cargoContent = await fs.readFile(path.join(workspacePath, "Cargo.toml"), "utf-8");
      if (cargoContent.includes("actix")) return "actix";
      if (cargoContent.includes("axum")) return "axum";
      if (cargoContent.includes("rocket")) return "rocket";
    }

    // Ruby
    if (entries.includes("Gemfile")) {
      const gemfileContent = await fs.readFile(path.join(workspacePath, "Gemfile"), "utf-8");
      if (gemfileContent.includes("rails")) return "rails";
      if (gemfileContent.includes("sinatra")) return "sinatra";
    }
  } catch {
    // Continue
  }

  return null;
}

/**
 * Parse Express app to extract routes
 */
async function parseExpressApp(workspacePath: string): Promise<Endpoint[]> {
  const endpoints: Endpoint[] = [];

  try {
    // Look for route files
    const srcPath = path.join(workspacePath, "src");
    const routesPath = path.join(workspacePath, "routes");

    for (const dirPath of [srcPath, routesPath, workspacePath]) {
      try {
        const files = await fs.readdir(dirPath);
        for (const file of files) {
          if (!file.endsWith(".js") && !file.endsWith(".ts")) continue;

          const filePath = path.join(dirPath, file);
          const content = await fs.readFile(filePath, "utf-8");

          // Simple regex to find routes
          const routePatterns = content.match(
            /(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/g,
          );

          if (routePatterns) {
            for (const pattern of routePatterns) {
              const match = pattern.match(/\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/);
              if (match) {
                endpoints.push({
                  method: match[1].toUpperCase(),
                  path: match[2],
                  description: `Auto-detected from ${file}`,
                });
              }
            }
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }
  } catch (err) {
    console.error("[v0] Express parsing error:", err);
  }

  return endpoints;
}

/**
 * Parse FastAPI app to extract routes
 */
async function parseFastAPIApp(workspacePath: string): Promise<Endpoint[]> {
  const endpoints: Endpoint[] = [];

  try {
    const mainPath = path.join(workspacePath, "main.py");
    try {
      const content = await fs.readFile(mainPath, "utf-8");

      // Simple regex to find FastAPI routes
      const routePatterns = content.match(/@app\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/g);

      if (routePatterns) {
        for (const pattern of routePatterns) {
          const match = pattern.match(/@app\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/);
          if (match) {
            endpoints.push({
              method: match[1].toUpperCase(),
              path: match[2],
              description: "FastAPI endpoint",
            });
          }
        }
      }
    } catch {
      // File doesn't exist
    }
  } catch (err) {
    console.error("[v0] FastAPI parsing error:", err);
  }

  return endpoints;
}

/**
 * Parse Django app to extract routes
 */
async function parseDjangoApp(workspacePath: string): Promise<Endpoint[]> {
  const endpoints: Endpoint[] = [];

  try {
    const urlsPath = path.join(workspacePath, "urls.py");
    try {
      const content = await fs.readFile(urlsPath, "utf-8");

      // Simple regex to find Django URL patterns
      const routePatterns = content.match(/path\(\s*["']([^"']+)["']/g);

      if (routePatterns) {
        for (const pattern of routePatterns) {
          const match = pattern.match(/path\(\s*["']([^"']+)["']/);
          if (match) {
            endpoints.push({
              method: "GET",
              path: match[1],
              description: "Django URL pattern",
            });
          }
        }
      }
    } catch {
      // File doesn't exist
    }
  } catch (err) {
    console.error("[v0] Django parsing error:", err);
  }

  return endpoints;
}

// Detect API framework
router.get("/api-explorer/framework", async (req, res) => {
  const workspaceId = String(req.query.workspaceId || "default").slice(0, 64);

  try {
    const framework = await detectAPIFramework(workspaceId);
    res.json({ ok: true, framework });
  } catch (err) {
    res.status(500).json({ error: "Failed to detect API framework" });
  }
});

// Extract API endpoints from source code
router.get("/api-explorer/endpoints", async (req, res) => {
  const workspaceId = String(req.query.workspaceId || "default").slice(0, 64);
  const workspacePath = path.join("/tmp/workspaces", workspaceId);

  try {
    const framework = await detectAPIFramework(workspaceId);
    let endpoints: Endpoint[] = [];

    if (framework === "express" || framework === "fastify" || framework === "hono" || framework === "nextjs") {
      endpoints = await parseExpressApp(workspacePath);
    } else if (framework === "fastapi") {
      endpoints = await parseFastAPIApp(workspacePath);
    } else if (framework === "django") {
      endpoints = await parseDjangoApp(workspacePath);
    } else if (framework === "flask") {
      endpoints = await parseExpressApp(workspacePath); // Similar pattern to Express
    }

    res.json({ ok: true, framework, endpoints });
  } catch (err) {
    res.status(500).json({ error: "Failed to extract endpoints" });
  }
});

// Make HTTP request to API endpoint
router.post("/api-explorer/request", async (req, res) => {
  const baseUrl = String(req.body?.baseUrl || "http://localhost:3000").slice(0, 256);
  const method = String(req.body?.method || "GET").slice(0, 20);
  const endpoint = String(req.body?.endpoint || "/").slice(0, 256);
  const headers = req.body?.headers && typeof req.body.headers === "object" ? req.body.headers : {};
  const body = req.body?.body;

  try {
    const url = `${baseUrl}${endpoint}`;
    const curlCmd = [
      'curl',
      `-X ${method}`,
      `"${url}"`,
      `-H "Content-Type: application/json"`,
    ];

    // Add custom headers
    for (const [key, value] of Object.entries(headers)) {
      curlCmd.push(`-H "${key}: ${value}"`);
    }

    // Add body if present
    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      curlCmd.push(`-d '${JSON.stringify(body)}'`);
    }

    const output = execSync(curlCmd.join(" "), { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 });

    try {
      const json = JSON.parse(output);
      res.json({ ok: true, response: json, status: 200 });
    } catch {
      res.json({ ok: true, response: output, status: 200 });
    }
  } catch (err: any) {
    res.json({
      ok: false,
      error: err.stderr ? err.stderr.toString() : String(err.message),
      status: err.status || 500,
    });
  }
});

// Generate API documentation (OpenAPI/Swagger-like format)
router.get("/api-explorer/documentation", async (req, res) => {
  const workspaceId = String(req.query.workspaceId || "default").slice(0, 64);
  const workspacePath = path.join("/tmp/workspaces", workspaceId);

  try {
    const framework = await detectAPIFramework(workspaceId);
    const endpoints = await (async () => {
      if (framework === "express" || framework === "fastify") {
        return parseExpressApp(workspacePath);
      } else if (framework === "fastapi") {
        return parseFastAPIApp(workspacePath);
      } else if (framework === "django") {
        return parseDjangoApp(workspacePath);
      }
      return [];
    })();

    const spec: APISpec = {
      framework: framework || "unknown",
      language: framework ? (["fastapi", "django", "flask"].includes(framework) ? "python" : "javascript") : "unknown",
      endpoints,
      baseUrl: "http://localhost:3000",
      documentation: `Auto-generated API documentation for ${framework || "unknown"} framework`,
    };

    res.json({ ok: true, spec });
  } catch (err) {
    res.status(500).json({ error: "Failed to generate documentation" });
  }
});

// Test GraphQL endpoint
router.post("/api-explorer/graphql", async (req, res) => {
  const endpoint = String(req.body?.endpoint || "http://localhost:3000/graphql").slice(0, 256);
  const query = String(req.body?.query || "").slice(0, 10000);

  try {
    const result = execSync(
      `curl -X POST "${endpoint}" -H "Content-Type: application/json" -d '${JSON.stringify({ query })}'`,
      { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 },
    );

    try {
      const json = JSON.parse(result);
      res.json({ ok: true, response: json });
    } catch {
      res.json({ ok: true, response: result });
    }
  } catch (err: any) {
    res.json({ ok: false, error: err.stderr ? err.stderr.toString() : String(err.message) });
  }
});

export default router;
