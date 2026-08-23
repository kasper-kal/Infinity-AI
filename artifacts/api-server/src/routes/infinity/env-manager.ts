import { Router } from "express";
import { readWorkspaceFileText, writeWorkspaceFile, listWorkspaceFiles } from "../../lib/workspace";
import { cleanText } from "../../lib/text-utils";

interface EnvVariable {
  key: string;
  value: string;
  secret: boolean;
  environment: string;
}

interface EnvFile {
  filename: string;
  environment: string;
  variables: EnvVariable[];
  lastModified: Date;
}

const router = Router();

// Parse .env file content into key-value pairs
function parseEnvContent(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = content.split("\n");
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    
    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();
    
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    
    env[key] = value;
  }
  
  return env;
}

// Convert key-value pairs back to .env format
function stringifyEnvContent(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => {
      // Quote values containing spaces or special characters
      if (value.includes(" ") || value.includes("\n") || value.includes("=")) {
        return `${key}="${value.replace(/"/g, '\\"')}"`;
      }
      return `${key}=${value}`;
    })
    .join("\n");
}

// Detect if a key looks like a secret
function isSecret(key: string, value: string): boolean {
  const secretKeywords = ["secret", "key", "token", "password", "apikey", "api_key", "auth", "credential"];
  const lowerKey = key.toLowerCase();
  return secretKeywords.some(kw => lowerKey.includes(kw)) || value.length > 50;
}

// Get all .env files
router.get("/env/files", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
  
  try {
    const files = await listWorkspaceFiles(workspaceId);
    const envFiles = files
      .filter(f => f.type === "file" && /^\.env(\.|$)/.test(f.name))
      .map(f => ({
        filename: f.name,
        path: f.path,
        environment: f.name === ".env" ? "default" : f.name.replace(/^\.env\./, ""),
      }));
    
    res.json({ ok: true, files: envFiles });
  } catch (err) {
    req.log.error({ err }, "Failed to list env files");
    res.status(500).json({ error: "Failed to list env files" });
  }
});

// Parse and get variables from specific .env file
router.get("/env/:filename", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
  const filename = cleanText(req.params.filename, 64);
  
  if (!filename.startsWith(".env")) {
    return res.status(400).json({ error: "Invalid .env filename" });
  }
  
  try {
    const content = await readWorkspaceFileText(filename, workspaceId);
    const parsed = parseEnvContent(content);
    
    const variables: EnvVariable[] = Object.entries(parsed).map(([key, value]) => ({
      key,
      value,
      secret: isSecret(key, value),
      environment: filename === ".env" ? "default" : filename.replace(/^\.env\./, ""),
    }));
    
    return res.json({
      ok: true,
      filename,
      variables,
      count: variables.length,
    });
  } catch {
    return res.status(404).json({ error: "Env file not found" });
  }
});

// Create or update a variable
router.post("/env/:filename/set", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
  const filename = cleanText(req.params.filename, 64);
  const key = cleanText(req.body?.key, 128);
  const value = cleanText(req.body?.value, 10000);
  
  if (!filename.startsWith(".env") || !key) {
    return res.status(400).json({ error: "Invalid filename or key" });
  }
  
  try {
    let content = "";
    try {
      content = await readWorkspaceFileText(filename, workspaceId);
    } catch {
      // File doesn't exist, create new
      content = "";
    }
    
    const env = parseEnvContent(content);
    env[key] = value || "";
    
    const updated = stringifyEnvContent(env);
    await writeWorkspaceFile(filename, updated, workspaceId);
    
    return res.json({
      ok: true,
      message: `Variable ${key} set successfully`,
      key,
      value: isSecret(key, value) ? "***" : value,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to set env variable");
    return res.status(500).json({ error: "Failed to set variable" });
  }
});

// Delete a variable
router.post("/env/:filename/delete", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
  const filename = cleanText(req.params.filename, 64);
  const key = cleanText(req.body?.key, 128);
  
  if (!filename.startsWith(".env") || !key) {
    return res.status(400).json({ error: "Invalid filename or key" });
  }
  
  try {
    const content = await readWorkspaceFileText(filename, workspaceId);
    const env = parseEnvContent(content);
    
    if (!(key in env)) {
      return res.status(404).json({ error: "Variable not found" });
    }
    
    delete env[key];
    const updated = stringifyEnvContent(env);
    await writeWorkspaceFile(filename, updated, workspaceId);
    
    return res.json({
      ok: true,
      message: `Variable ${key} deleted`,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to delete env variable");
    return res.status(500).json({ error: "Failed to delete variable" });
  }
});

// Get all variables across all .env files
router.get("/env/all", async (req, res) => {
  const workspaceId = cleanText(req.query.workspaceId as string, 64) || "default";
  
  try {
    const files = await listWorkspaceFiles(workspaceId);
    const envFiles = files.filter(f => f.type === "file" && /^\.env(\.|$)/.test(f.name));
    
    const allVariables: Record<string, EnvVariable[]> = {};
    
    for (const file of envFiles) {
      try {
        const content = await readWorkspaceFileText(file.path, workspaceId);
        const parsed = parseEnvContent(content);
        allVariables[file.name] = Object.entries(parsed).map(([key, value]) => ({
          key,
          value,
          secret: isSecret(key, value),
          environment: file.name === ".env" ? "default" : file.name.replace(/^\.env\./, ""),
        }));
      } catch {
        // Skip if can't read
      }
    }
    
    res.json({
      ok: true,
      files: allVariables,
      totalVariables: Object.values(allVariables).reduce((sum, vars) => sum + vars.length, 0),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get all env variables");
    res.status(500).json({ error: "Failed to get variables" });
  }
});

// Suggest template .env based on detected framework
router.get("/env/template", async (req, res) => {
  const framework = cleanText(req.query.framework as string, 64);
  
  const templates: Record<string, Record<string, string>> = {
    nextjs: {
      "NEXT_PUBLIC_API_URL": "http://localhost:3000",
      "API_SECRET": "your-secret-key-here",
      "DATABASE_URL": "postgresql://user:password@localhost:5432/mydb",
    },
    django: {
      "DEBUG": "True",
      "SECRET_KEY": "your-secret-key-here",
      "DATABASE_URL": "postgresql://user:password@localhost:5432/mydb",
      "ALLOWED_HOSTS": "localhost,127.0.0.1",
    },
    fastapi: {
      "DATABASE_URL": "postgresql://user:password@localhost:5432/mydb",
      "API_KEY": "your-api-key-here",
      "DEBUG": "True",
    },
    rails: {
      "DATABASE_URL": "postgresql://user:password@localhost:5432/mydb",
      "SECRET_KEY_BASE": "your-secret-key-here",
      "RAILS_ENV": "development",
    },
    default: {
      "NODE_ENV": "development",
      "DEBUG": "true",
      "API_URL": "http://localhost:3000",
    },
  };
  
  const template = templates[framework] || templates.default;
  res.json({ ok: true, template });
});

export default router;
