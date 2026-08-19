import { createBestAdapter } from "./adapter-factory";
import { buildInfinityPrompt } from "./infinity-prompt";
import { randomUUID } from "crypto";
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Promo Maker — Core Engine
 *
 * Creates promotional videos from a website URL + natural language prompt.
 * Uses Puppeteer for recording, Web Audio API for ASMR sounds, FFmpeg for encoding.
 */

// Types
export interface PromoScriptStep {
  action: "navigate" | "click" | "type" | "scroll" | "wait" | "hover" | "zoom" | "pan";
  url?: string;
  selector?: string;
  text?: string;
  charDelay?: number;
  direction?: "up" | "down" | "left" | "right";
  distance?: number;
  delay?: number;
  wait?: number;
  description: string; // For text overlay
  // Narrative structure fields
  section?: "hook" | "demo" | "cta";
  // Brand/visual fields
  textStyle?: "title" | "subtitle" | "body" | "caption";
  textPosition?: "top" | "center" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

export interface BrandKit {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  fonts: {
    heading: { name: string; url: string; cssVariable: string };
    body: { name: string; url: string; cssVariable: string };
  };
  logo?: string;
}

export interface PromoScript {
  steps: PromoScriptStep[];
  estimatedDuration: number; // seconds
  targetDuration: number; // seconds
  // Narrative structure
  sections?: {
    hook: PromoScriptStep[];
    demo: PromoScriptStep[];
    cta: PromoScriptStep[];
  };
  // Brand kit for styling
  brandKit?: BrandKit;
}

export interface PromoJob {
  id: string;
  url: string;
  prompt: string;
  duration: number;
  targetDuration: number; // target duration for the final video
  style: "professional" | "energetic" | "minimal" | "cinematic";
  status: "planning" | "recording" | "audio" | "encoding" | "optimizing" | "completed" | "failed";
  progress: number; // 0-100
  script?: PromoScript;
  videoPath?: string;
  thumbnailPath?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  // Brand kit from company project
  brandKit?: BrandKit;
  // Device frame for mockup
  deviceFrame?: "none" | "iphone" | "macbook" | "ipad" | "auto";
  // Internal tracking
  framesDir?: string;
  audioPath?: string;
  rawVideoPath?: string;
}

export interface RecordingFrame {
  path: string;
  timestamp: number; // ms from start
  stepIndex: number;
  cursorX: number;
  cursorY: number;
  action: string;
}

// Job storage (in-memory, could be persisted to DB)
const jobs = new Map<string, PromoJob>();

// Configuration
const CONFIG = {
  outputDir: join(process.cwd(), ".infinity", "promo-output"),
  framesDir: join(process.cwd(), ".infinity", "promo-frames"),
  tempDir: join(process.cwd(), ".infinity", "promo-temp"),
  defaultWidth: 1920,
  defaultHeight: 1080,
  fps: 30,
  cursorSize: 24,
  clickRippleDuration: 300, // ms
  typingSpeed: 80, // ms per char
};

/**
 * Initialize output directories
 */
function initDirs(): void {
  [CONFIG.outputDir, CONFIG.framesDir, CONFIG.tempDir].forEach(dir => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  });
}

/**
 * Create a new promo job
 */
export function createPromoJob(
  url: string,
  prompt: string,
  duration: number = 30,
  style: "professional" | "energetic" | "minimal" | "cinematic" = "professional"
): PromoJob {
  initDirs();

  const job: PromoJob = {
    id: randomUUID(),
    url,
    prompt,
    duration,
    targetDuration: duration,
    style,
    status: "planning",
    progress: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  jobs.set(job.id, job);
  return job;
}

/**
 * Get job by ID
 */
export function getPromoJob(id: string): PromoJob | undefined {
  return jobs.get(id);
}

/**
 * Update job status and progress
 */
function updateJob(id: string, updates: Partial<PromoJob>): void {
  const job = jobs.get(id);
  if (job) {
    Object.assign(job, updates, { updatedAt: new Date() });
  }
}

/**
 * Generate script using LLM with narrative structure (hook → demo → CTA)
 */
export async function generateScript(job: PromoJob): Promise<PromoScript> {
  updateJob(job.id, { status: "planning", progress: 10 });

  const adapter = await createBestAdapter();

  const brandKitInfo = job.brandKit
    ? `\nBrand Kit:\n- Primary Color: ${job.brandKit.colors.primary}\n- Secondary Color: ${job.brandKit.colors.secondary}\n- Accent Color: ${job.brandKit.colors.accent}\n- Background: ${job.brandKit.colors.background}\n- Text: ${job.brandKit.colors.text}\n- Heading Font: ${job.brandKit.fonts.heading.name} (${job.brandKit.fonts.heading.url})\n- Body Font: ${job.brandKit.fonts.body.name} (${job.brandKit.fonts.body.url})`
    : "";

  const systemPrompt = `You are a video director creating a step-by-step script for a promotional video.
The script will be executed by Puppeteer to record a website demonstration.

Output ONLY valid JSON in this exact format:
{
  "steps": [
    {"action": "navigate", "url": "https://example.com", "wait": 3000, "description": "Opening homepage...", "section": "hook", "textStyle": "title", "textPosition": "center"},
    {"action": "click", "selector": "button#signup", "delay": 500, "description": "Clicking Sign Up...", "section": "demo", "textStyle": "body", "textPosition": "bottom"},
    {"action": "type", "selector": "input#email", "text": "demo@example.com", "charDelay": 80, "description": "Entering email...", "section": "demo", "textStyle": "caption", "textPosition": "bottom-left"},
    {"action": "scroll", "direction": "down", "distance": 500, "delay": 1000, "description": "Scrolling to features...", "section": "demo", "textStyle": "subtitle", "textPosition": "top"},
    {"action": "wait", "wait": 2000, "description": "Pausing to show feature...", "section": "cta", "textStyle": "title", "textPosition": "center"}
  ],
  "estimatedDuration": 15,
  "targetDuration": 15,
  "sections": {
    "hook": [...],
    "demo": [...],
    "cta": [...]
  }
}

Rules:
- Actions: navigate, click, type, scroll, wait, hover, zoom, pan
- Always include "description" for text overlays
- Use realistic selectors (prefer data-testid, id, aria-label, then class)
- Estimate duration per step: navigate=3s, click=1s, type=charDelay*length, scroll=1s, wait=specified, zoom=2s, pan=2s
- Total estimatedDuration should be close to targetDuration
- Max 20 steps for a 30s video
- STRUCTURE: First 20-30% = HOOK (grab attention, show problem/value), Middle 50-60% = DEMO (show features in action), Last 15-20% = CTA (call to action, brand)
- Add "section" field to each step: "hook", "demo", or "cta"
- Add "textStyle" field: "title" (large, bold), "subtitle" (medium), "body" (regular), "caption" (small)
- Add "textPosition" field: "top", "center", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"
- Hook section: use zoom/pan for dramatic reveals, strong titles
- Demo section: show real interactions, use captions for feature names
- CTA section: brand logo, tagline, website URL`;

  const userPrompt = `Create a promotional video script for: ${job.url}

Goal: ${job.prompt}
Target duration: ${job.duration} seconds
Style: ${job.style}${brandKitInfo}

Analyze the website and create a script that showcases the key features mentioned in the prompt.
Follow the narrative structure: HOOK (first 20-30%) → DEMO (middle 50-60%) → CTA (last 15-20%).
Use zoom/pan actions for dramatic camera movements in the hook section.`;

  try {
    const response = await adapter.complete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        temperature: 0.3,
        maxTokens: 4000,
      }
    );

    const content = response.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");

    const script = JSON.parse(jsonMatch[0]) as PromoScript;

    // Validate and clamp
    script.steps = script.steps.slice(0, 20);
    script.targetDuration = job.duration;
    script.estimatedDuration = Math.max(script.estimatedDuration, 1);

    // Organize steps into sections
    script.sections = {
      hook: script.steps.filter(s => s.section === "hook"),
      demo: script.steps.filter(s => s.section === "demo"),
      cta: script.steps.filter(s => s.section === "cta"),
    };

    // Attach brand kit to script
    if (job.brandKit) {
      script.brandKit = job.brandKit;
    }

    updateJob(job.id, { script, progress: 20 });
    return script;
  } catch (error) {
    console.error("[PromoMaker] Script generation failed:", error);
    // Fallback script with narrative structure
    const fallbackScript: PromoScript = {
      steps: [
        { action: "navigate", url: job.url, wait: 3000, description: "Opening website...", section: "hook", textStyle: "title", textPosition: "center" },
        { action: "zoom", selector: "main", distance: 1.5, delay: 2000, description: "Discover the future", section: "hook", textStyle: "title", textPosition: "center" },
        { action: "wait", wait: 2000, description: "Loading page...", section: "hook", textStyle: "subtitle", textPosition: "bottom" },
        { action: "scroll", direction: "down", distance: 800, delay: 2000, description: "Scrolling to features...", section: "demo", textStyle: "body", textPosition: "bottom" },
        { action: "click", selector: "button.demo", delay: 500, description: "Trying the demo...", section: "demo", textStyle: "caption", textPosition: "bottom-left" },
        { action: "wait", wait: 2000, description: "See it in action...", section: "demo", textStyle: "body", textPosition: "bottom" },
        { action: "pan", selector: ".features", distance: 300, delay: 1500, description: "Explore all features", section: "demo", textStyle: "subtitle", textPosition: "top" },
        { action: "wait", wait: 1500, description: "Start your journey today", section: "cta", textStyle: "title", textPosition: "center" },
      ],
      estimatedDuration: 14.5,
      targetDuration: job.duration,
      sections: {
        hook: [
          { action: "navigate", url: job.url, wait: 3000, description: "Opening website...", section: "hook", textStyle: "title", textPosition: "center" },
          { action: "zoom", selector: "main", distance: 1.5, delay: 2000, description: "Discover the future", section: "hook", textStyle: "title", textPosition: "center" },
          { action: "wait", wait: 2000, description: "Loading page...", section: "hook", textStyle: "subtitle", textPosition: "bottom" },
        ],
        demo: [
          { action: "scroll", direction: "down", distance: 800, delay: 2000, description: "Scrolling to features...", section: "demo", textStyle: "body", textPosition: "bottom" },
          { action: "click", selector: "button.demo", delay: 500, description: "Trying the demo...", section: "demo", textStyle: "caption", textPosition: "bottom-left" },
          { action: "wait", wait: 2000, description: "See it in action...", section: "demo", textStyle: "body", textPosition: "bottom" },
          { action: "pan", selector: ".features", distance: 300, delay: 1500, description: "Explore all features", section: "demo", textStyle: "subtitle", textPosition: "top" },
        ],
        cta: [
          { action: "wait", wait: 1500, description: "Start your journey today", section: "cta", textStyle: "title", textPosition: "center" },
        ],
      },
    };
    if (job.brandKit) {
      fallbackScript.brandKit = job.brandKit;
    }
    updateJob(job.id, { script: fallbackScript, progress: 20 });
    return fallbackScript;
  }
}

/**
 * Record frames using Puppeteer with spring-physics cursor, zoom/pan, device frames
 */
export async function recordFrames(job: PromoJob): Promise<RecordingFrame[]> {
  if (!job.script) throw new Error("No script generated");

  updateJob(job.id, { status: "recording", progress: 30 });

  const framesDir = join(CONFIG.framesDir, job.id);
  if (existsSync(framesDir)) rmSync(framesDir, { recursive: true });
  mkdirSync(framesDir, { recursive: true });

  updateJob(job.id, { framesDir });

  // Dynamic import puppeteer
  const puppeteer = await import("puppeteer");
  const { default: puppeteerDefault } = puppeteer;

  const browser = await puppeteerDefault.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
      `--window-size=${CONFIG.defaultWidth},${CONFIG.defaultHeight}`,
    ],
    defaultViewport: {
      width: CONFIG.defaultWidth,
      height: CONFIG.defaultHeight,
      deviceScaleFactor: 1,
    },
  });

  const page = await browser.newPage();

  // Initialize spring-physics cursor system
  await initCursorSystem(page);
  await setCursorPosition(page, CONFIG.defaultWidth / 2, CONFIG.defaultHeight / 2);

  // Enable CDP for screencast
  const client = await page.target().createCDPSession();
  await client.send("Page.startScreencast", {
    format: "png",
    quality: 90,
    maxWidth: CONFIG.defaultWidth,
    maxHeight: CONFIG.defaultHeight,
    everyNthFrame: 1,
  });

  const frames: RecordingFrame[] = [];
  let frameCount = 0;
  let currentStepIndex = 0;
  let startTime = Date.now();

  // Handle screencast frames
  client.on("Page.screencastFrame", async (frame) => {
    const timestamp = Date.now() - startTime;

    // Save frame
    const framePath = join(framesDir, `frame_${String(frameCount).padStart(6, "0")}.png`);
    writeFileSync(framePath, Buffer.from(frame.data, "base64"));

    frames.push({
      path: framePath,
      timestamp,
      stepIndex: currentStepIndex,
      cursorX: 0, // cursor is rendered in-page now
      cursorY: 0,
      action: job.script!.steps[currentStepIndex]?.action || "idle",
    });

    frameCount++;
    await client.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
  });

  try {
    // Execute script steps with enhanced actions
    for (let i = 0; i < job.script.steps.length; i++) {
      currentStepIndex = i;
      const step = job.script.steps[i];

      updateJob(job.id, { progress: 30 + Math.floor((i / job.script.steps.length) * 40) });

      switch (step.action) {
        case "navigate": {
          await page.goto(step.url || job.url, { waitUntil: "networkidle2", timeout: 30000 });
          // Reset cursor to center on navigation
          await setCursorPosition(page, CONFIG.defaultWidth / 2, CONFIG.defaultHeight / 2);
          await sleep(step.wait || 2000);
          break;
        }
        case "click": {
          if (step.selector) {
            const element = await page.$(step.selector);
            if (element) {
              const box = await element.boundingBox();
              if (box) {
                const targetX = box.x + box.width / 2;
                const targetY = box.y + box.height / 2;
                // Spring-physics move with magnetic attraction
                await moveCursorSpring(page, targetX, targetY, 600);
                // Click with ripple
                await clickCursor(page);
                await element.click({ delay: step.delay || 80 });
              }
              await sleep(step.delay || 400);
            }
          }
          break;
        }
        case "type": {
          if (step.selector && step.text) {
            const element = await page.$(step.selector);
            if (element) {
              const box = await element.boundingBox();
              if (box) {
                const targetX = box.x + box.width / 2;
                const targetY = box.y + box.height / 2;
                await moveCursorSpring(page, targetX, targetY, 400);
              }
              await element.click();
              // Show typing cursor
              await setCursorTyping(page, true);
              await page.keyboard.type(step.text, { delay: step.charDelay || CONFIG.typingSpeed });
              await setCursorTyping(page, false);
              await sleep(step.delay || 400);
            }
          }
          break;
        }
        case "scroll": {
          const direction = step.direction || "down";
          const distance = step.distance || 500;
          // Smooth scroll with cursor following
          await page.evaluate((d) => {
            window.scrollBy({ top: d, behavior: 'smooth' });
          }, direction === "down" ? distance : -distance);
          await sleep(step.delay || 1200);
          break;
        }
        case "hover": {
          if (step.selector) {
            const element = await page.$(step.selector);
            if (element) {
              const box = await element.boundingBox();
              if (box) {
                const targetX = box.x + box.width / 2;
                const targetY = box.y + box.height / 2;
                await moveCursorSpring(page, targetX, targetY, 500);
              }
              await element.hover();
              await sleep(step.wait || 600);
            }
          }
          break;
        }
        case "zoom": {
          // New action: zoom into element (ken burns style)
          if (step.selector) {
            const element = await page.$(step.selector);
            if (element) {
              const box = await element.boundingBox();
              if (box) {
                // Apply zoom transform to page
                const scale = step.distance || 1.5;
                await page.evaluate(([x, y, s]) => {
                  document.body.style.transformOrigin = `${x}px ${y}px`;
                  document.body.style.transition = 'transform 800ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                  document.body.style.transform = `scale(${s}) translate(${-x * (s - 1)}px, ${-y * (s - 1)}px)`;
                }, [box.x + box.width / 2, box.y + box.height / 2, scale]);
                await sleep(step.delay || 1500);
                // Reset zoom
                await page.evaluate(() => {
                  document.body.style.transform = 'scale(1) translate(0, 0)';
                });
                await sleep(400);
              }
            }
          }
          break;
        }
        case "pan": {
          // New action: pan across page
          if (step.selector) {
            const element = await page.$(step.selector);
            if (element) {
              const box = await element.boundingBox();
              if (box) {
                const startX = box.x + box.width / 2;
                const startY = box.y + box.height / 2;
                const endX = startX + (step.distance || 300);
                const endY = startY;
                await page.evaluate(([sx, sy, ex, ey]) => {
                  document.body.style.transformOrigin = `${sx}px ${sy}px`;
                  document.body.style.transition = 'transform 1200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                  document.body.style.transform = `translate(${sx - ex}px, ${sy - ey}px) scale(1.2)`;
                }, [startX, startY, endX, endY]);
                await sleep(step.delay || 1500);
                await page.evaluate(() => {
                  document.body.style.transform = 'scale(1) translate(0, 0)';
                });
                await sleep(400);
              }
            }
          }
          break;
        }
        case "wait":
        default: {
          await sleep(step.wait || 1000);
          break;
        }
      }
    }

    // Final wait
    await sleep(1000);
  } finally {
    await client.send("Page.stopScreencast");
    await browser.close();
  }

  updateJob(job.id, { progress: 70 });
  return frames;
}

/**
 * Spring-physics cursor with magnetic attraction, trails, and state awareness
 * Apple/OpenAI quality: spring-damper model, magnetic targets, click ripple, trails
 */
interface CursorState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  isClicking: boolean;
  isHovering: boolean;
  isTyping: boolean;
  trail: Array<{ x: number; y: number; t: number; alpha: number }>;
}

async function initCursorSystem(page: any): Promise<void> {
  // Inject the cursor system as a script to avoid TypeScript issues with browser globals
  const cursorScript = `
    (function() {
      // Create cursor root
      const root = document.createElement("div");
      root.id = "__promo_cursor_root__";
      root.style.cssText = \`
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        pointer-events: none;
        z-index: 2147483647;
        overflow: hidden;
      \`;
      document.body.appendChild(root);

      // Trail container (renders behind cursor)
      const trailContainer = document.createElement("div");
      trailContainer.id = "__promo_cursor_trail__";
      trailContainer.style.cssText = \`position: absolute; inset: 0;\`;
      root.appendChild(trailContainer);

      // Main cursor
      const cursor = document.createElement("div");
      cursor.id = "__promo_cursor__";
      cursor.style.cssText = \`
        position: absolute;
        pointer-events: none;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        transform: translate(-50%, -50%) scale(1);
        will-change: transform, opacity, width, height, border-radius;
        transition:
          width 120ms cubic-bezier(0.34, 1.56, 0.64, 1),
          height 120ms cubic-bezier(0.34, 1.56, 0.64, 1),
          border-radius 120ms cubic-bezier(0.34, 1.56, 0.64, 1),
          background 80ms ease-out,
          box-shadow 80ms ease-out;
        background: radial-gradient(circle at 30% 30%, #ffffff 0%, #0ea5e9 60%, #0284c7 100%);
        border: 2px solid #ffffff;
        box-shadow:
          0 0 0 2px rgba(14,165,233,0.6),
          0 4px 16px rgba(0,0,0,0.25),
          0 0 24px rgba(14,165,233,0.4),
          inset 0 -2px 4px rgba(0,0,0,0.1);
      \`;
      root.appendChild(cursor);

      // Click ripple ring
      const ripple = document.createElement("div");
      ripple.id = "__promo_cursor_ripple__";
      ripple.style.cssText = \`
        position: absolute;
        pointer-events: none;
        border-radius: 50%;
        border: 2px solid #0ea5e9;
        transform: translate(-50%, -50%) scale(0);
        opacity: 0;
        will-change: transform, opacity;
      \`;
      root.appendChild(ripple);

      // Magnetic target indicator
      const magnet = document.createElement("div");
      magnet.id = "__promo_cursor_magnet__";
      magnet.style.cssText = \`
        position: absolute;
        pointer-events: none;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 1.5px dashed #0ea5e9;
        transform: translate(-50%, -50%) scale(0);
        opacity: 0;
        will-change: transform, opacity;
        transition: transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 120ms ease-out;
      \`;
      root.appendChild(magnet);

      // Store state on window for access
      window.__promoCursorState = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        vx: 0,
        vy: 0,
        targetX: window.innerWidth / 2,
        targetY: window.innerHeight / 2,
        isClicking: false,
        isHovering: false,
        isTyping: false,
        trail: [],
        cursorEl: cursor,
        rippleEl: ripple,
        magnetEl: magnet,
        trailContainer: trailContainer,
        animationId: 0,
        lastFrame: performance.now(),
      };

      // Spring physics constants (Apple-like)
      const SPRING_STIFFNESS = 180;
      const SPRING_DAMPING = 22;
      const MASS = 1;
      const TRAIL_MAX_LENGTH = 8;
      const TRAIL_FADE_MS = 180;
      const MAGNET_RADIUS = 80;

      // Magnetic element detector
      function findMagneticTarget(x, y) {
        const elements = document.querySelectorAll(
          'a, button, [role="button"], input, textarea, select, [onclick], [data-testid], [href], .btn, .button, [type="submit"]'
        );
        let closest = null;
        elements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dx = cx - x;
          const dy = cy - y;
          const dist = Math.hypot(dx, dy);
          if (dist < MAGNET_RADIUS && (!closest || dist < closest.dist)) {
            closest = { x: cx, y: cy, dist };
          }
        });
        return closest ? { x: closest.x, y: closest.y } : null;
      }

      // Animation loop with spring physics
      function animate() {
        const state = window.__promoCursorState;
        if (!state) return;

        const now = performance.now();
        const dt = Math.min((now - state.lastFrame) / 1000, 1 / 30); // cap at 30fps min
        state.lastFrame = now;

        // Find magnetic target
        const magnetic = findMagneticTarget(state.x, state.y);
        if (magnetic && !state.isClicking) {
          // Blend target toward magnetic center
          const magnetStrength = 1 - magnetic.dist / MAGNET_RADIUS;
          state.targetX += (magnetic.x - state.targetX) * magnetStrength * 0.15;
          state.targetY += (magnetic.y - state.targetY) * magnetStrength * 0.15;
          state.magnetEl.style.left = magnetic.x + "px";
          state.magnetEl.style.top = magnetic.y + "px";
          state.magnetEl.style.transform = "translate(-50%, -50%) scale(" + (0.8 + magnetStrength * 0.4) + ")";
          state.magnetEl.style.opacity = (0.3 + magnetStrength * 0.5).toString();
          state.isHovering = true;
        } else {
          state.magnetEl.style.opacity = "0";
          state.magnetEl.style.transform = "translate(-50%, -50%) scale(0)";
          state.isHovering = false;
        }

        // Spring physics: F = -k*x - d*v
        const dx = state.targetX - state.x;
        const dy = state.targetY - state.y;
        const ax = (SPRING_STIFFNESS * dx - SPRING_DAMPING * state.vx) / MASS;
        const ay = (SPRING_STIFFNESS * dy - SPRING_DAMPING * state.vy) / MASS;

        state.vx += ax * dt;
        state.vy += ay * dt;
        state.x += state.vx * dt;
        state.y += state.vy * dt;

        // Update cursor position
        state.cursorEl.style.left = state.x + "px";
        state.cursorEl.style.top = state.y + "px";

        // Cursor state visual changes
        if (state.isClicking) {
          state.cursorEl.style.width = "22px";
          state.cursorEl.style.height = "22px";
          state.cursorEl.style.borderRadius = "40%";
          state.cursorEl.style.boxShadow = \`
            0 0 0 3px rgba(14,165,233,0.8),
            0 2px 8px rgba(0,0,0,0.3),
            0 0 32px rgba(14,165,233,0.6),
            inset 0 2px 4px rgba(0,0,0,0.2)
          \`;
        } else if (state.isTyping) {
          state.cursorEl.style.width = "2px";
          state.cursorEl.style.height = "24px";
          state.cursorEl.style.borderRadius = "1px";
          state.cursorEl.style.background = "#0ea5e9";
          state.cursorEl.style.border = "none";
          state.cursorEl.style.boxShadow = "0 0 16px rgba(14,165,233,0.8), 0 0 32px rgba(14,165,233,0.4)";
        } else if (state.isHovering) {
          state.cursorEl.style.width = "36px";
          state.cursorEl.style.height = "36px";
          state.cursorEl.style.borderRadius = "50%";
          state.cursorEl.style.boxShadow = \`
            0 0 0 3px rgba(14,165,233,0.5),
            0 6px 24px rgba(0,0,0,0.2),
            0 0 32px rgba(14,165,233,0.5),
            inset 0 -2px 4px rgba(0,0,0,0.1)
          \`;
        } else {
          state.cursorEl.style.width = "28px";
          state.cursorEl.style.height = "28px";
          state.cursorEl.style.borderRadius = "50%";
          state.cursorEl.style.background = "radial-gradient(circle at 30% 30%, #ffffff 0%, #0ea5e9 60%, #0284c7 100%)";
          state.cursorEl.style.border = "2px solid #ffffff";
          state.cursorEl.style.boxShadow = \`
            0 0 0 2px rgba(14,165,233,0.6),
            0 4px 16px rgba(0,0,0,0.25),
            0 0 24px rgba(14,165,233,0.4),
            inset 0 -2px 4px rgba(0,0,0,0.1)
          \`;
        }

        // Trail system
        state.trail.push({ x: state.x, y: state.y, t: now, alpha: 1 });
        if (state.trail.length > TRAIL_MAX_LENGTH) state.trail.shift();

        // Render trails
        state.trailContainer.innerHTML = "";
        state.trail.forEach((pt, i) => {
          const age = now - pt.t;
          const progress = age / TRAIL_FADE_MS;
          if (progress >= 1) return;
          const trailEl = document.createElement("div");
          const size = 28 * (1 - progress * 0.7);
          trailEl.style.cssText = \`
            position: absolute;
            left: \${pt.x}px;
            top: \${pt.y}px;
            width: \${size}px;
            height: \${size}px;
            border-radius: 50%;
            transform: translate(-50%, -50%);
            background: radial-gradient(circle at 30% 30%, #ffffff 0%, #0ea5e9 100%);
            opacity: \${(1 - progress) * 0.35 * (i / TRAIL_MAX_LENGTH)};
            pointer-events: none;
            will-change: opacity;
          \`;
          state.trailContainer.appendChild(trailEl);
        });

        state.animationId = requestAnimationFrame(animate);
      }

      // Start animation loop
      window.__promoCursorState.animationId = requestAnimationFrame(animate);

      // Expose control functions
      window.__promoCursorMove = function(x, y) {
        const state = window.__promoCursorState;
        if (state) { state.targetX = x; state.targetY = y; }
      };
      window.__promoCursorClick = function(down) {
        const state = window.__promoCursorState;
        if (!state) return;
        state.isClicking = down;
        if (down) {
          // Trigger ripple
          state.rippleEl.style.left = state.x + "px";
          state.rippleEl.style.top = state.y + "px";
          state.rippleEl.style.width = "0px";
          state.rippleEl.style.height = "0px";
          state.rippleEl.style.opacity = "1";
          state.rippleEl.style.transform = "translate(-50%, -50%) scale(0)";
          // Animate ripple
          requestAnimationFrame(function() {
            state.rippleEl.style.transition = "transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease-out";
            state.rippleEl.style.width = "80px";
            state.rippleEl.style.height = "80px";
            state.rippleEl.style.transform = "translate(-50%, -50%) scale(1)";
            state.rippleEl.style.opacity = "0";
          });
          // Clear transition after
          setTimeout(function() { state.rippleEl.style.transition = ""; }, 300);
        }
      };
      window.__promoCursorType = function(typing) {
        const state = window.__promoCursorState;
        if (state) state.isTyping = typing;
      };
      window.__promoCursorSetPos = function(x, y) {
        const state = window.__promoCursorState;
        if (state) { state.x = x; state.y = y; state.targetX = x; state.targetY = y; state.vx = 0; state.vy = 0; }
      };
    })();
  `;

  await page.evaluate(cursorScript);
}

/**
 * Move cursor with spring physics to target
 */
async function moveCursorSpring(page: any, toX: number, toY: number, durationMs: number = 600): Promise<void> {
  await page.evaluate(([x, y]: [number, number]) => {
    (window as any).__promoCursorMove(x, y);
  }, [toX, toY]);
  await sleep(durationMs);
}

/**
 * Click with ripple effect
 */
async function clickCursor(page: any): Promise<void> {
  await page.evaluate(() => {
    (window as any).__promoCursorClick(true);
  });
  await sleep(80);
  await page.evaluate(() => {
    (window as any).__promoCursorClick(false);
  });
}

/**
 * Set cursor typing state
 */
async function setCursorTyping(page: any, typing: boolean): Promise<void> {
  await page.evaluate((t: boolean) => {
    (window as any).__promoCursorType(t);
  }, [typing]);
}

/**
 * Set cursor position instantly (for teleport)
 */
async function setCursorPosition(page: any, x: number, y: number): Promise<void> {
  await page.evaluate(([cx, cy]: [number, number]) => {
    (window as any).__promoCursorSetPos(cx, cy);
  }, [x, y]);
}

/**
 * Generate ASMR audio track with procedural sounds (clicks, whooshes, ambient, typing)
 * Apple/OpenAI quality: layered procedural audio with FFmpeg filter complex
 */
export async function generateAudioTrack(job: PromoJob, frames: RecordingFrame[]): Promise<string> {
  updateJob(job.id, { status: "audio", progress: 75 });

  const audioPath = join(CONFIG.tempDir, `${job.id}_audio.wav`);

  // Calculate total duration from frames
  const totalDuration = frames.length > 0
    ? (frames[frames.length - 1].timestamp / 1000)
    : job.duration;

  // Generate a comprehensive FFmpeg filter_complex for ASMR audio
  // This creates: ambient bed + click sounds + whoosh on scroll + typing ticks + transition sweeps
  let filterComplex = `
    // Ambient bed - subtle room tone with slight harmonic content
    anullsrc=r=44100:cl=stereo:d=${Math.ceil(totalDuration)}[silence];
    [silence]aevalsrc="0.002*sin(2*PI*40*t) + 0.001*sin(2*PI*80*t) + 0.0005*sin(2*PI*120*t)"[ambient];
    [ambient]lowpass=f=200:width_type=h:w=50[ambient_lp];
    [ambient_lp]volume=0.15[ambient_final];
    [ambient_final]anull[base];
  `;

  // Add click sounds at click actions
  if (job.script) {
    let currentTime = 0;
    for (let i = 0; i < job.script.steps.length; i++) {
      const step = job.script.steps[i];
      const stepDuration = estimateStepDuration(step);

      if (step.action === "click") {
        // Sharp click transient
        filterComplex += `
          anullsrc=r=44100:cl=stereo:d=0.08[click_${i}];
          [click_${i}]aevalsrc="exp(-100*t)*(0.8*sin(2*PI*1200*t) + 0.3*sin(2*PI*2400*t) + 0.1*sin(2*PI*4800*t))"[click_gen_${i}];
          [click_gen_${i}]highpass=f=800[click_hp_${i}];
          [click_hp_${i}]volume=0.4[click_final_${i}];
          [base][click_final_${i}]adelay=${Math.round(currentTime * 1000)}|${Math.round(currentTime * 1000)}[base];
        `;
      } else if (step.action === "scroll") {
        // Whoosh/swipe sound
        filterComplex += `
          anullsrc=r=44100:cl=stereo:d=${Math.min(stepDuration, 1.5)}[whoosh_${i}];
          [whoosh_${i}]aevalsrc="exp(-3*t)*(0.15*sin(2*PI*400*t*exp(2*t)) + 0.08*sin(2*PI*800*t*exp(2*t)))"[whoosh_gen_${i}];
          [whoosh_gen_${i}]bandpass=f=600:width_type=h:w=200[whoosh_bp_${i}];
          [whoosh_bp_${i}]volume=0.25[whoosh_final_${i}];
          [base][whoosh_final_${i}]adelay=${Math.round(currentTime * 1000)}|${Math.round(currentTime * 1000)}[base];
        `;
      } else if (step.action === "type" && step.text) {
        // Typing ticks - one per character
        const charCount = step.text.length;
        const charInterval = stepDuration / charCount;
        for (let c = 0; c < Math.min(charCount, 30); c++) {
          const tickTime = currentTime + c * charInterval;
          filterComplex += `
            anullsrc=r=44100:cl=stereo:d=0.03[tick_${i}_${c}];
            [tick_${i}_${c}]aevalsrc="exp(-150*t)*0.3*sin(2*PI*800*t)"[tick_gen_${i}_${c}];
            [tick_gen_${i}_${c}]highpass=f=1500[tick_hp_${i}_${c}];
            [tick_hp_${i}_${c}]volume=0.15[tick_final_${i}_${c}];
            [base][tick_final_${i}_${c}]adelay=${Math.round(tickTime * 1000)}|${Math.round(tickTime * 1000)}[base];
          `;
        }
      } else if (step.action === "navigate" && i > 0) {
        // Page transition sweep
        filterComplex += `
          anullsrc=r=44100:cl=stereo:d=0.6[sweep_${i}];
          [sweep_${i}]aevalsrc="exp(-2*t)*0.12*sin(2*PI*200*t*exp(3*t))"[sweep_gen_${i}];
          [sweep_gen_${i}]lowpass=f=1000:width_type=h:w=100[sweep_lp_${i}];
          [sweep_lp_${i}]volume=0.2[sweep_final_${i}];
          [base][sweep_final_${i}]adelay=${Math.round(currentTime * 1000)}|${Math.round(currentTime * 1000)}[base];
        `;
      } else if (step.action === "zoom" || step.action === "pan") {
        // Camera movement sound
        filterComplex += `
          anullsrc=r=44100:cl=stereo:d=${stepDuration}[cam_${i}];
          [cam_${i}]aevalsrc="0.03*sin(2*PI*60*t) + 0.015*sin(2*PI*120*t)"[cam_gen_${i}];
          [cam_gen_${i}]lowpass=f=300[cam_lp_${i}];
          [cam_lp_${i}]volume=0.15[cam_final_${i}];
          [base][cam_final_${i}]adelay=${Math.round(currentTime * 1000)}|${Math.round(currentTime * 1000)}[base];
        `;
      }

      currentTime += stepDuration;
    }
  }

  // Add subtle reverb tail to everything
  filterComplex += `
    [base]aecho=0.8:0.3:50:0.15[reverb];
    [reverb]volume=0.9[final_audio];
  `;

  // Write filter complex to temp file for FFmpeg
  const filterFile = join(CONFIG.tempDir, `${job.id}_audio_filter.txt`);
  writeFileSync(filterFile, filterComplex);

  // Generate audio using FFmpeg filter complex
  const audioCmd = `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo:d=${Math.ceil(totalDuration)} -filter_complex_script "${filterFile}" -map "[final_audio]" -c:a pcm_s16le "${audioPath}"`;

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("bash", ["-c", audioCmd]);
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ASMR audio generation failed: ${code}`)));
    proc.on("error", reject);
  });

  updateJob(job.id, { audioPath, progress: 80 });
  return audioPath;
}

/**
 * Download font from Google Fonts URL and return local path
 */
async function downloadFont(fontUrl: string, fontName: string): Promise<string | null> {
  const fontDir = join(CONFIG.tempDir, "fonts");
  if (!existsSync(fontDir)) mkdirSync(fontDir, { recursive: true });

  const fontPath = join(fontDir, `${fontName.replace(/\s+/g, "_")}.ttf`);

  // Check if already downloaded
  if (existsSync(fontPath)) return fontPath;

  try {
    // Extract font family from Google Fonts URL
    // URL format: https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap
    const familyMatch = fontUrl.match(/family=([^&]+)/);
    if (!familyMatch) return null;

    const family = decodeURIComponent(familyMatch[1]);
    // Download the CSS to get actual font URLs
    const cssResponse = await fetch(fontUrl);
    const cssText = await cssResponse.text();

    // Extract TTF/WOFF2 URLs from CSS
    const fontUrls = cssText.match(/url\(([^)]+\.(?:ttf|woff2))\)/g);
    if (!fontUrls || fontUrls.length === 0) return null;

    // Use first TTF URL found
    const ttfUrl = fontUrls.find(u => u.includes(".ttf")) || fontUrls[0];
    const cleanUrl = ttfUrl.replace(/url\(['"]?([^'"]+)['"]?\)/, "$1");

    const fontResponse = await fetch(cleanUrl);
    if (!fontResponse.ok) return null;

    const buffer = await fontResponse.arrayBuffer();
    writeFileSync(fontPath, Buffer.from(buffer));
    return fontPath;
  } catch (error) {
    console.error("[PromoMaker] Font download failed:", error);
    return null;
  }
}

/**
 * Get or create device frame overlay image
 */
async function getDeviceFrameImage(device: "iphone" | "macbook" | "ipad"): Promise<string> {
  const framesDir = join(CONFIG.tempDir, "device-frames");
  if (!existsSync(framesDir)) mkdirSync(framesDir, { recursive: true });

  const framePath = join(framesDir, `${device}.png`);

  // Check if already created
  if (existsSync(framePath)) return framePath;

  // Create device frame using FFmpeg drawing
  // These are SVG-based device frames rendered to PNG
  const frameConfigs = {
    iphone: {
      width: 1920,
      height: 1080,
      // iPhone 15 Pro in center
      deviceWidth: 780,
      deviceHeight: 1690,
      cornerRadius: 56,
      notchWidth: 200,
      notchHeight: 36,
      bezel: 20,
    },
    macbook: {
      width: 1920,
      height: 1080,
      // MacBook Pro 14" in center
      deviceWidth: 1500,
      deviceHeight: 960,
      cornerRadius: 16,
      notchWidth: 0,
      notchHeight: 0,
      bezel: 12,
    },
    ipad: {
      width: 1920,
      height: 1080,
      // iPad Pro 12.9" in center
      deviceWidth: 1032,
      deviceHeight: 1376,
      cornerRadius: 24,
      notchWidth: 0,
      notchHeight: 0,
      bezel: 16,
    },
  };

  const config = frameConfigs[device];
  const centerX = Math.floor((config.width - config.deviceWidth) / 2);
  const centerY = Math.floor((config.height - config.deviceHeight) / 2);

  // Create SVG for device frame
  let svgContent = "";
  if (device === "iphone") {
    svgContent = `
      <svg width="${config.width}" height="${config.height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="20" stdDeviation="30" flood-color="#000" flood-opacity="0.3"/>
          </filter>
          <clipPath id="screenClip">
            <rect x="${centerX + config.bezel}" y="${centerY + config.bezel}"
                  width="${config.deviceWidth - 2 * config.bezel}"
                  height="${config.deviceHeight - 2 * config.bezel}"
                  rx="${config.cornerRadius - config.bezel}"/>
          </clipPath>
        </defs>
        <!-- Device body -->
        <rect x="${centerX}" y="${centerY}"
              width="${config.deviceWidth}" height="${config.deviceHeight}"
              rx="${config.cornerRadius}" fill="#1a1a1a" filter="url(#shadow)"/>
        <!-- Screen area (transparent for video overlay) -->
        <rect x="${centerX + config.bezel}" y="${centerY + config.bezel}"
              width="${config.deviceWidth - 2 * config.bezel}"
              height="${config.deviceHeight - 2 * config.bezel}"
              rx="${config.cornerRadius - config.bezel}" fill="#000"/>
        <!-- Dynamic Island -->
        <rect x="${centerX + (config.deviceWidth - config.notchWidth) / 2}"
              y="${centerY + config.bezel - 4}"
              width="${config.notchWidth}" height="${config.notchHeight}"
              rx="${config.notchHeight / 2}" fill="#0a0a0a"/>
        <!-- Side button -->
        <rect x="${centerX - 4}" y="${centerY + config.deviceHeight * 0.3}"
              width="4" height="80" rx="2" fill="#2a2a2a"/>
        <!-- Volume buttons -->
        <rect x="${centerX + config.deviceWidth}" y="${centerY + config.deviceHeight * 0.25}"
              width="4" height="40" rx="2" fill="#2a2a2a"/>
        <rect x="${centerX + config.deviceWidth}" y="${centerY + config.deviceHeight * 0.33}"
              width="4" height="40" rx="2" fill="#2a2a2a"/>
      </svg>
    `;
  } else if (device === "macbook") {
    svgContent = `
      <svg width="${config.width}" height="${config.height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="30" stdDeviation="40" flood-color="#000" flood-opacity="0.35"/>
          </filter>
        </defs>
        <!-- Screen lid -->
        <rect x="${centerX}" y="${centerY}"
              width="${config.deviceWidth}" height="${config.deviceHeight}"
              rx="${config.cornerRadius}" fill="#1a1a2e" filter="url(#shadow)"/>
        <!-- Screen area -->
        <rect x="${centerX + config.bezel}" y="${centerY + config.bezel}"
              width="${config.deviceWidth - 2 * config.bezel}"
              height="${config.deviceHeight - 2 * config.bezel}"
              rx="${config.cornerRadius - config.bezel}" fill="#000"/>
        <!-- Camera notch area (thin top bezel) -->
        <rect x="${centerX + config.bezel}" y="${centerY + config.bezel}"
              width="${config.deviceWidth - 2 * config.bezel}" height="8"
              fill="#1a1a2e"/>
        <!-- Keyboard base -->
        <rect x="${centerX - 40}" y="${centerY + config.deviceHeight + 8}"
              width="${config.deviceWidth + 80}" height="40"
              rx="8" fill="#111" filter="url(#shadow)"/>
        <!-- Trackpad -->
        <rect x="${centerX + (config.deviceWidth - 200) / 2}" y="${centerY + config.deviceHeight + 20}"
              width="200" height="140" rx="12" fill="#222"/>
      </svg>
    `;
  } else if (device === "ipad") {
    svgContent = `
      <svg width="${config.width}" height="${config.height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="20" stdDeviation="30" flood-color="#000" flood-opacity="0.3"/>
          </filter>
        </defs>
        <!-- Device body -->
        <rect x="${centerX}" y="${centerY}"
              width="${config.deviceWidth}" height="${config.deviceHeight}"
              rx="${config.cornerRadius}" fill="#1a1a1a" filter="url(#shadow)"/>
        <!-- Screen area -->
        <rect x="${centerX + config.bezel}" y="${centerY + config.bezel}"
              width="${config.deviceWidth - 2 * config.bezel}"
              height="${config.deviceHeight - 2 * config.bezel}"
              rx="${config.cornerRadius - config.bezel}" fill="#000"/>
        <!-- Home indicator (bottom) -->
        <rect x="${centerX + (config.deviceWidth - 134) / 2}"
              y="${centerY + config.deviceHeight - config.bezel - 28}"
              width="134" height="5" rx="2.5" fill="#333"/>
        <!-- Top camera -->
        <circle cx="${centerX + config.deviceWidth / 2}"
                cy="${centerY + config.bezel + 12}" r="6" fill="#0a0a0a"/>
      </svg>
    `;
  }

  const svgPath = join(framesDir, `${device}.svg`);
  writeFileSync(svgPath, svgContent);

  // Convert SVG to PNG using FFmpeg
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", "-i", svgPath, "-vf", "scale=1920:1080", framePath]);
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Device frame creation failed: ${code}`)));
    proc.on("error", reject);
  });

  return framePath;
}

/**
 * Assemble video from frames using FFmpeg with professional quality:
 * - Brand kit colors/fonts
 * - Device frame mockups (iPhone, MacBook, iPad)
 * - Color grading/post-processing
 * - Professional text overlays with animations
 * - Smooth section transitions
 */
export async function assembleVideo(job: PromoJob, frames: RecordingFrame[]): Promise<string> {
  updateJob(job.id, { status: "encoding", progress: 85 });

  const framesDir = job.framesDir!;
  const rawVideoPath = join(CONFIG.tempDir, `${job.id}_raw.mp4`);
  const finalVideoPath = join(CONFIG.outputDir, `${job.id}.mp4`);

  // Create video from frames
  const framePattern = join(framesDir, "frame_%06d.png");

  // First pass: create raw video from frames
  const videoCmd = `ffmpeg -y -framerate ${CONFIG.fps} -i "${framePattern}" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2" "${rawVideoPath}"`;

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("bash", ["-c", videoCmd]);
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Video encoding failed: ${code}`)));
    proc.on("error", reject);
  });

  // Generate audio track
  const audioPath = await generateAudioTrack(job, frames);

  // Second pass: combine video + audio + text overlays + color grading + device frame
  let filterComplex = "";
  let overlayIndex = 0;
  let currentLabel = "0:v";

  // Get brand kit colors
  const brandKit = job.script?.brandKit || job.brandKit;
  const primaryColor = brandKit?.colors?.primary || "#0ea5e9";
  const secondaryColor = brandKit?.colors?.secondary || "#0284c7";
  const accentColor = brandKit?.colors?.accent || "#f97316";
  const bgColor = brandKit?.colors?.background || "#0f172a";
  const textColor = brandKit?.colors?.text || "#ffffff";

  // Convert hex to FFmpeg format (0xRRGGBB)
  const hexToFfmpeg = (hex: string) => {
    const clean = hex.replace("#", "");
    return `0x${clean}`;
  };

  // Color grading filter - cinematic look
  const colorGradeFilter = `
    [0:v]
    eq=contrast=1.1:brightness=0.02:saturation=1.15,
    curves=preset=strong_contrast,
    vignette=PI/4:eval=frame
  `;

  if (job.script) {
    let currentTime = 0;
    for (let i = 0; i < job.script.steps.length; i++) {
      const step = job.script.steps[i];
      const stepDuration = estimateStepDuration(step);
      const description = step.description.replace(/[':]/g, "\\$&").replace(/[\\]/g, "\\\\"); // Escape for ffmpeg

      if (description && stepDuration > 0.5) {
        // Determine text style based on section and textStyle field
        const isHook = step.section === "hook";
        const isCTA = step.section === "cta";
        const isDemo = step.section === "demo";

        let fontsize = 48;
        let fontweight = "Bold";
        let boxcolor = "black@0.6";
        let fontcolor = textColor;
        let boxborderw = 16;
        let xPos = "(w-text_w)/2";
        let yPos = "h-120";
        let animation = "";

        // Style based on textStyle field
        switch (step.textStyle) {
          case "title":
            fontsize = isHook ? 72 : isCTA ? 64 : 56;
            fontweight = "Bold";
            boxcolor = `${primaryColor}@0.8`;
            break;
          case "subtitle":
            fontsize = 42;
            fontweight = "Medium";
            boxcolor = `${secondaryColor}@0.7`;
            break;
          case "body":
            fontsize = 32;
            fontweight = "Regular";
            boxcolor = "black@0.6";
            break;
          case "caption":
            fontsize = 24;
            fontweight = "Light";
            boxcolor = "black@0.5";
            break;
        }

        // Position based on textPosition field
        switch (step.textPosition) {
          case "top":
            yPos = "80";
            break;
          case "center":
            yPos = "(h-text_h)/2";
            break;
          case "bottom":
            yPos = "h-120";
            break;
          case "top-left":
            xPos = "80";
            yPos = "80";
            break;
          case "top-right":
            xPos = "w-text_w-80";
            yPos = "80";
            break;
          case "bottom-left":
            xPos = "80";
            yPos = "h-text_h-120";
            break;
          case "bottom-right":
            xPos = "w-text_w-80";
            yPos = "h-text_h-120";
            break;
        }

        // Add fade in/out animation
        const fadeIn = 0.3;
        const fadeOut = 0.3;
        animation = `alpha='if(lt(t,${currentTime.toFixed(1)}+${fadeIn}),(t-${currentTime.toFixed(1)})/${fadeIn},if(gt(t,${(currentTime + stepDuration).toFixed(1)}-${fadeOut}),(1-(t-${(currentTime + stepDuration).toFixed(1)}+${fadeOut})/${fadeOut}),1))'`;

        // Build drawtext filter with brand colors and positioning
        // Use custom font from brand kit if available
        let fontFile = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
        let fontWeight = "Bold";
        if (brandKit?.fonts) {
          if (step.textStyle === "title" || step.textStyle === "subtitle") {
            // Try to download heading font
            const headingFontPath = await downloadFont(brandKit.fonts.heading.url, brandKit.fonts.heading.name);
            if (headingFontPath) {
              fontFile = headingFontPath;
              fontWeight = "Regular"; // Use downloaded font weight
            }
          } else {
            // Try to download body font
            const bodyFontPath = await downloadFont(brandKit.fonts.body.url, brandKit.fonts.body.name);
            if (bodyFontPath) {
              fontFile = bodyFontPath;
              fontWeight = "Regular";
            }
          }
        }

        filterComplex += `[${currentLabel}]drawtext=text='${description}':fontfile='${fontFile}':fontsize=${fontsize}:fontcolor=${fontcolor}:fontcolor_expr=${hexToFfmpeg(fontcolor)}:box=1:boxcolor=${boxcolor}:boxborderw=${boxborderw}:x=${xPos}:y=${yPos}:${animation}:enable='between(t,${currentTime.toFixed(1)},${(currentTime + stepDuration).toFixed(1)})'[v${overlayIndex}];`;
        currentLabel = `v${overlayIndex}`;
        overlayIndex++;
      }
      currentTime += stepDuration;
    }
  }

  // Apply color grading
  filterComplex += `[${currentLabel}]${colorGradeFilter}[graded];`;
  currentLabel = "graded";

  // Apply device frame if specified
  const deviceFrame = job.deviceFrame || "none";
  if (deviceFrame !== "none" && ["iphone", "macbook", "ipad"].includes(deviceFrame)) {
    try {
      // Get/create device frame image
      const deviceFramePath = await getDeviceFrameImage(deviceFrame as "iphone" | "macbook" | "ipad");
      // Overlay device frame on video
      filterComplex += `[${currentLabel}][${overlayIndex}:v]overlay=(W-w)/2:(H-h)/2[device_framed];`;
      currentLabel = "device_framed";
      // We'll add the device frame as an additional input
    } catch (e) {
      console.error("[PromoMaker] Device frame failed:", e);
    }
  }

  // Final output with audio
  // Build inputs: video + audio + device frame (if applicable)
  let inputArgs = `-i "${rawVideoPath}" -i "${audioPath}"`;
  if (deviceFrame !== "none" && ["iphone", "macbook", "ipad"].includes(deviceFrame)) {
    try {
      const deviceFramePath = await getDeviceFrameImage(deviceFrame as "iphone" | "macbook" | "ipad");
      inputArgs += ` -i "${deviceFramePath}"`;
    } catch (e) {
      console.error("[PromoMaker] Device frame input failed:", e);
    }
  }

  const finalCmd = `ffmpeg -y ${inputArgs} -filter_complex "${filterComplex}[${currentLabel}]" -map "[${currentLabel}]" -map 1:a -c:v libx264 -preset slow -crf 18 -c:a aac -b:a 192k -movflags +faststart -shortest "${finalVideoPath}"`;

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("bash", ["-c", finalCmd]);
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Final encoding failed: ${code}`)));
    proc.on("error", reject);
  });

  // Generate thumbnail
  const thumbnailPath = join(CONFIG.outputDir, `${job.id}_thumb.jpg`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", "-i", finalVideoPath, "-ss", "00:00:01", "-vframes", "1", "-vf", "scale=320:-1", thumbnailPath]);
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Thumbnail failed: ${code}`)));
    proc.on("error", reject);
  });

  updateJob(job.id, { rawVideoPath, videoPath: finalVideoPath, thumbnailPath, progress: 90 });
  return finalVideoPath;
}

/**
 * Estimate duration of a script step
 */
export function estimateStepDuration(step: PromoScriptStep): number {
  switch (step.action) {
    case "navigate": return (step.wait || 3000) / 1000;
    case "click": return (step.delay || 500) / 1000 + 0.5;
    case "type": return step.text ? (step.text.length * (step.charDelay || CONFIG.typingSpeed)) / 1000 : 1;
    case "scroll": return (step.delay || 1000) / 1000 + 0.5;
    case "wait": return (step.wait || 1000) / 1000;
    case "hover": return (step.wait || 500) / 1000 + 0.3;
    case "zoom": return (step.delay || 1500) / 1000 + 0.5;
    case "pan": return (step.delay || 1500) / 1000 + 0.5;
    default: return 1;
  }
}

/**
 * Optimize video speed - re-encode slow sections at 2-4x
 */
export async function optimizeVideoSpeed(job: PromoJob): Promise<string> {
  updateJob(job.id, { status: "optimizing", progress: 95 });

  if (!job.rawVideoPath || !job.script) {
    return job.videoPath!;
  }

  const optimizedPath = join(CONFIG.outputDir, `${job.id}_optimized.mp4`);

  // Analyze actual vs target duration
  const actualDuration = job.script.steps.reduce((sum, s) => sum + estimateStepDuration(s), 0);
  const targetDuration = job.targetDuration;

  if (actualDuration <= targetDuration * 1.1) {
    // Already close enough, just copy
    const copyCmd = `ffmpeg -y -i "${job.videoPath}" -c copy "${optimizedPath}"`;
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("bash", ["-c", copyCmd]);
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Copy failed: ${code}`)));
      proc.on("error", reject);
    });
    updateJob(job.id, { videoPath: optimizedPath, progress: 100 });
    return optimizedPath;
  }

  // Use LLM to identify slow sections and create speed map
  const adapter = await createBestAdapter();

  const analysisPrompt = `Analyze this promo video script and identify which sections are too slow.
Target duration: ${targetDuration}s
Actual estimated: ${actualDuration.toFixed(1)}s
Script: ${JSON.stringify(job.script.steps.map((s, i) => ({ i, action: s.action, desc: s.description, estDur: estimateStepDuration(s) })))}

Return JSON with speed multipliers per step index:
{ "speeds": [1.0, 1.5, 1.0, 2.0, 1.0] }`;

  try {
    const response = await adapter.complete(
      [
        { role: "system", content: "You are a video editor optimizing pacing. Return only JSON." },
        { role: "user", content: analysisPrompt },
      ],
      { temperature: 0.2, maxTokens: 1000 }
    );

    const content = response.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const { speeds } = JSON.parse(jsonMatch[0]);

      // Build ffmpeg filter with variable speed
      let filterParts: string[] = [];
      let inputIndex = 0;

      job.script.steps.forEach((step, i) => {
        const speed = speeds[i] || 1.0;
        if (speed !== 1.0) {
          filterParts.push(`[${inputIndex}:v]setpts=${1/speed}*PTS[v${i}];`);
          filterParts.push(`[${inputIndex}:a]atempo=${speed}[a${i}];`);
          inputIndex++;
        } else {
          filterParts.push(`[${inputIndex}:v]copy[v${i}];`);
          filterParts.push(`[${inputIndex}:a]copy[a${i}];`);
          inputIndex++;
        }
      });

      // This is simplified - real implementation would need to split video by segments
      // For now, just apply uniform speed adjustment
      const avgSpeed = actualDuration / targetDuration;
      const clampedSpeed = Math.min(Math.max(avgSpeed, 1.0), 4.0);

      const speedCmd = `ffmpeg -y -i "${job.videoPath}" -filter:v "setpts=${1/clampedSpeed}*PTS" -filter:a "atempo=${clampedSpeed}" "${optimizedPath}"`;

      await new Promise<void>((resolve, reject) => {
        const proc = spawn("bash", ["-c", speedCmd]);
        proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Speed optimization failed: ${code}`)));
        proc.on("error", reject);
      });

      updateJob(job.id, { videoPath: optimizedPath, progress: 100 });
      return optimizedPath;
    }
  } catch (error) {
    console.error("[PromoMaker] Speed optimization failed:", error);
  }

  // Fallback: uniform speed
  const avgSpeed = actualDuration / targetDuration;
  const clampedSpeed = Math.min(Math.max(avgSpeed, 1.0), 4.0);

  const speedCmd = `ffmpeg -y -i "${job.videoPath}" -filter:v "setpts=${1/clampedSpeed}*PTS" -filter:a "atempo=${clampedSpeed}" "${optimizedPath}"`;

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("bash", ["-c", speedCmd]);
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Speed optimization failed: ${code}`)));
    proc.on("error", reject);
  });

  updateJob(job.id, { videoPath: optimizedPath, progress: 100 });
  return optimizedPath;
}

/**
 * Main orchestrator function
 */
export async function createPromoVideo(
  url: string,
  prompt: string,
  duration: number = 30,
  style: "professional" | "energetic" | "minimal" | "cinematic" = "professional"
): Promise<PromoJob> {
  const job = createPromoJob(url, prompt, duration, style);

  try {
    // Phase 1: Generate script
    await generateScript(job);

    // Phase 2: Record frames
    const frames = await recordFrames(job);

    // Phase 3: Assemble video with audio
    await assembleVideo(job, frames);

    // Phase 4: Optimize speed
    await optimizeVideoSpeed(job);

    updateJob(job.id, { status: "completed", progress: 100 });

    // Cleanup temp files
    cleanupJob(job.id);

    return getPromoJob(job.id)!;
  } catch (error) {
    console.error("[PromoMaker] Failed:", error);
    updateJob(job.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      progress: 100,
    });
    cleanupJob(job.id);
    return getPromoJob(job.id)!;
  }
}

/**
 * Clean up temporary files for a job
 */
function cleanupJob(jobId: string): void {
  const job = jobs.get(jobId);
  if (job?.framesDir && existsSync(job.framesDir)) {
    try { rmSync(job.framesDir, { recursive: true }); } catch {}
  }
  if (job?.audioPath && existsSync(job.audioPath)) {
    try { rmSync(job.audioPath); } catch {}
  }
  if (job?.rawVideoPath && existsSync(job.rawVideoPath)) {
    try { rmSync(job.rawVideoPath); } catch {}
  }
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * List all jobs
 */
export function listPromoJobs(): PromoJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Delete a job and its files
 */
export function deletePromoJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;

  cleanupJob(id);
  if (job.videoPath && existsSync(job.videoPath)) {
    try { rmSync(job.videoPath); } catch {}
  }
  if (job.thumbnailPath && existsSync(job.thumbnailPath)) {
    try { rmSync(job.thumbnailPath); } catch {}
  }

  jobs.delete(id);
  return true;
}