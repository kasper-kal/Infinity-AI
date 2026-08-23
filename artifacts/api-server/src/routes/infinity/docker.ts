import { Router } from "express";
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";

const router = Router();

interface DockerContainer {
  id: string;
  image: string;
  name: string;
  status: string;
  ports: string[];
  createdAt: string;
}

interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  createdAt: string;
}

/**
 * Check if Docker is installed and running
 */
function isDockerAvailable(): boolean {
  try {
    execSync("docker --version", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse Docker PS output to get containers
 */
function parseContainers(output: string): DockerContainer[] {
  const lines = output.trim().split("\n").slice(1); // Skip header
  return lines
    .map((line) => {
      const parts = line.split(/\s{2,}/);
      if (parts.length < 6) return null;
      return {
        id: parts[0].slice(0, 12),
        image: parts[1],
        name: parts[6] || "unknown",
        status: parts[4],
        ports: parts[5] ? [parts[5]] : [],
        createdAt: new Date().toISOString(),
      };
    })
    .filter((c): c is DockerContainer => c !== null);
}

/**
 * Parse Docker images output
 */
function parseImages(output: string): DockerImage[] {
  const lines = output.trim().split("\n").slice(1); // Skip header
  return lines
    .map((line) => {
      const parts = line.split(/\s{2,}/);
      if (parts.length < 5) return null;
      return {
        id: parts[2].slice(0, 12),
        repository: parts[0],
        tag: parts[1],
        size: parts[6] || "unknown",
        createdAt: new Date().toISOString(),
      };
    })
    .filter((img): img is DockerImage => img !== null);
}

// Check Docker availability
router.get("/docker/status", (req, res) => {
  try {
    const available = isDockerAvailable();
    if (!available) {
      return res.json({ ok: true, available: false, message: "Docker is not installed or not running" });
    }

    const version = execSync("docker --version", { encoding: "utf-8" }).trim();
    return res.json({ ok: true, available: true, version });
  } catch (err) {
    return res.status(500).json({ error: "Failed to check Docker status" });
  }
});

// List running containers
router.get("/docker/containers", (req, res) => {
  try {
    if (!isDockerAvailable()) {
      return res.status(400).json({ error: "Docker is not available" });
    }

    const output = execSync("docker ps --format='{{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.Names}}'", {
      encoding: "utf-8",
    });
    const containers = parseContainers(output);
    return res.json({ ok: true, containers });
  } catch (err) {
    return res.status(500).json({ error: "Failed to list containers" });
  }
});

// List all images
router.get("/docker/images", (req, res) => {
  try {
    if (!isDockerAvailable()) {
      return res.status(400).json({ error: "Docker is not available" });
    }

    const output = execSync("docker images --format='{{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedAt}}'", {
      encoding: "utf-8",
    });
    const images = parseImages(output);
    return res.json({ ok: true, images });
  } catch (err) {
    return res.status(500).json({ error: "Failed to list images" });
  }
});

// Build Docker image from workspace
router.post("/docker/build", async (req, res) => {
  const workspaceId = String(req.body?.workspaceId || "default").slice(0, 64);
  const imageName = String(req.body?.imageName || "jarvis-app").slice(0, 128);
  const dockerfilePath = String(req.body?.dockerfilePath || "Dockerfile").slice(0, 256);

  try {
    if (!isDockerAvailable()) {
      return res.status(400).json({ error: "Docker is not available" });
    }

    const fullPath = path.join("/tmp/workspaces", workspaceId);
    const dockerfile = path.join(fullPath, dockerfilePath);

    // Check if Dockerfile exists
    try {
      await fs.access(dockerfile);
    } catch {
      return res.status(404).json({ error: `Dockerfile not found at ${dockerfilePath}` });
    }

    const buildProcess = spawn("docker", ["build", "-t", imageName, "-f", dockerfile, fullPath], {
      cwd: fullPath,
    });

    let output = "";
    buildProcess.stdout?.on("data", (data) => {
      output += data.toString();
      res.write(`data: ${JSON.stringify({ status: "building", line: data.toString() })}\n\n`);
    });

    buildProcess.stderr?.on("data", (data) => {
      output += data.toString();
      res.write(`data: ${JSON.stringify({ status: "error", line: data.toString() })}\n\n`);
    });

    buildProcess.on("close", (code) => {
      res.write(
        `data: ${JSON.stringify({ status: code === 0 ? "success" : "failed", code, output })}\n\n`,
      );
      res.end();
    });
    return;
  } catch (err) {
    return res.status(500).json({ error: "Failed to build Docker image" });
  }
});

// Run Docker container
router.post("/docker/run", (req, res) => {
  const imageName = String(req.body?.imageName || "").slice(0, 128);
  const containerName = String(req.body?.containerName || "").slice(0, 128);
  const ports = Array.isArray(req.body?.ports) ? req.body.ports.map((p: unknown) => String(p).slice(0, 64)) : [];
  const env = req.body?.env && typeof req.body.env === "object" ? req.body.env : {};

  try {
    if (!isDockerAvailable()) {
      return res.status(400).json({ error: "Docker is not available" });
    }

    const dockerArgs = ["run", "-d"];

    if (containerName) {
      dockerArgs.push("--name", containerName);
    }

    // Add port mappings
    for (const port of ports) {
      dockerArgs.push("-p", port);
    }

    // Add environment variables
    for (const [key, value] of Object.entries(env)) {
      dockerArgs.push("-e", `${key}=${value}`);
    }

    dockerArgs.push(imageName);

    const output = execSync(`docker ${dockerArgs.join(" ")}`, { encoding: "utf-8" }).trim();
    const containerId = output.split("\n")[0];

    return res.json({ ok: true, containerId, message: "Container started" });
  } catch (err) {
    return res.status(500).json({ error: "Failed to run container" });
  }
});

// Stop container
router.post("/docker/stop", (req, res) => {
  const containerId = String(req.body?.containerId || "").slice(0, 128);

  try {
    if (!isDockerAvailable()) {
      return res.status(400).json({ error: "Docker is not available" });
    }

    execSync(`docker stop ${containerId}`, { encoding: "utf-8" });
    return res.json({ ok: true, message: "Container stopped" });
  } catch (err) {
    return res.status(500).json({ error: "Failed to stop container" });
  }
});

// Get container logs
router.get("/docker/logs/:containerId", (req, res) => {
  const containerId = String(req.params.containerId).slice(0, 128);
  const lines = Math.max(1, Math.min(1000, Number(req.query.lines) || 50));

  try {
    if (!isDockerAvailable()) {
      return res.status(400).json({ error: "Docker is not available" });
    }

    const output = execSync(`docker logs --tail ${lines} ${containerId}`, { encoding: "utf-8" });
    return res.json({ ok: true, logs: output });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch container logs" });
  }
});

// Remove container
router.post("/docker/remove", (req, res) => {
  const containerId = String(req.body?.containerId || "").slice(0, 128);
  const force = req.body?.force === true;

  try {
    if (!isDockerAvailable()) {
      return res.status(400).json({ error: "Docker is not available" });
    }

    const args = force ? ["-f"] : [];
    execSync(`docker rm ${args.join(" ")} ${containerId}`, { encoding: "utf-8" });
    return res.json({ ok: true, message: "Container removed" });
  } catch (err) {
    return res.status(500).json({ error: "Failed to remove container" });
  }
});

// Remove image
router.post("/docker/remove-image", (req, res) => {
  const imageId = String(req.body?.imageId || "").slice(0, 128);
  const force = req.body?.force === true;

  try {
    if (!isDockerAvailable()) {
      return res.status(400).json({ error: "Docker is not available" });
    }

    const args = force ? ["-f"] : [];
    execSync(`docker rmi ${args.join(" ")} ${imageId}`, { encoding: "utf-8" });
    return res.json({ ok: true, message: "Image removed" });
  } catch (err) {
    return res.status(500).json({ error: "Failed to remove image" });
  }
});

export default router;
