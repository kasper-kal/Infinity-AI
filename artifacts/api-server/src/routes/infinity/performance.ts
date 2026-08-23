import { Router, Request, Response } from "express";
import { chromium } from "playwright";
import { cleanText } from "../../lib/text-utils";

const router = Router();

interface PerformanceMetrics {
  url: string;
  fcp: number;
  lcp: number;
  cls: number;
  ttfb: number;
  loadTime: number;
  resourceCount: number;
  jsSize: number;
  cssSize: number;
  htmlSize: number;
  imageCount: number;
  memoryUsage: NodeJS.MemoryUsage;
  timestamp: number;
}

interface APIMetrics {
  endpoint: string;
  method: string;
  responseTime: number;
  statusCode: number;
  bodySize: number;
  timestamp: number;
}

/**
 * POST /performance/lighthouse - Run Lighthouse audit
 */
router.post("/performance/lighthouse", async (req: Request, res: Response) => {
  const url = cleanText(req.body?.url, 500) || "http://localhost:3000";

  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const metrics: PerformanceMetrics = {
      url,
      fcp: 0,
      lcp: 0,
      cls: 0,
      ttfb: 0,
      loadTime: 0,
      resourceCount: 0,
      jsSize: 0,
      cssSize: 0,
      htmlSize: 0,
      imageCount: 0,
      memoryUsage: process.memoryUsage(),
      timestamp: Date.now(),
    };

    const startTime = Date.now();

    // Collect performance entries
    page.on("load", async () => {
      const navigationTiming = await page.evaluate(() => {
        const perfData = window.performance.getEntriesByType("navigation")[0] as any;
        return {
          fcp: perfData.responseStart || 0,
          loadTime: perfData.loadEventEnd - perfData.fetchStart,
        };
      });

      metrics.fcp = navigationTiming.fcp;
      metrics.loadTime = navigationTiming.loadTime;
    });

    // Navigate to URL
    await page.goto(url, { waitUntil: "networkidle" });

    // Collect resource metrics
    const resources = await page.evaluate(() => {
      const entries = window.performance.getEntriesByType("resource");
      let jsSize = 0,
        cssSize = 0,
        imageCount = 0;

      entries.forEach((entry: any) => {
        if (entry.name.includes(".js")) jsSize += entry.transferSize || 0;
        if (entry.name.includes(".css")) cssSize += entry.transferSize || 0;
        if (/\.(png|jpg|jpeg|gif|webp)/.test(entry.name)) imageCount++;
      });

      return {
        resourceCount: entries.length,
        jsSize,
        cssSize,
        imageCount,
      };
    });

    metrics.resourceCount = resources.resourceCount;
    metrics.jsSize = resources.jsSize;
    metrics.cssSize = resources.cssSize;
    metrics.imageCount = resources.imageCount;

    // Collect CLS (Cumulative Layout Shift)
    const cls = await page.evaluate(() => {
      let cls = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if ((entry as any).hadRecentInput) continue;
          cls += (entry as any).value;
        }
      });
      observer.observe({ type: "layout-shift" as any, buffered: true });
      return cls;
    });

    metrics.cls = cls;
    metrics.ttfb = Date.now() - startTime;

    await browser.close();

    res.json({ ok: true, metrics });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /performance/memory - Track memory usage
 */
router.post("/performance/memory", (req: Request, res: Response) => {
  const memoryUsage = process.memoryUsage();

  res.json({
    ok: true,
    memory: {
      rss: memoryUsage.rss / 1024 / 1024, // MB
      heapTotal: memoryUsage.heapTotal / 1024 / 1024,
      heapUsed: memoryUsage.heapUsed / 1024 / 1024,
      external: memoryUsage.external / 1024 / 1024,
      arrayBuffers: memoryUsage.arrayBuffers / 1024 / 1024,
      timestamp: Date.now(),
    },
  });
});

/**
 * POST /performance/api - Measure API response times
 */
router.post("/performance/api", async (req: Request, res: Response) => {
  const endpoint = cleanText(req.body?.endpoint, 500);
  const method = cleanText(req.body?.method, 10)?.toUpperCase() || "GET";
  const iterations = Math.min(10, Number(req.body?.iterations) || 5);

  if (!endpoint) {
    return res.status(400).json({ error: "Endpoint required" });
  }

  const metrics: APIMetrics[] = [];

  try {
    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now();

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
      });

      const endTime = Date.now();
      const body = await response.text();

      metrics.push({
        endpoint,
        method,
        responseTime: endTime - startTime,
        statusCode: response.status,
        bodySize: Buffer.byteLength(body),
        timestamp: Date.now(),
      });
    }

    const avgResponseTime = metrics.reduce((sum, m) => sum + m.responseTime, 0) / metrics.length;
    const maxResponseTime = Math.max(...metrics.map((m) => m.responseTime));
    const minResponseTime = Math.min(...metrics.map((m) => m.responseTime));

    return res.json({
      ok: true,
      metrics,
      summary: {
        avgResponseTime,
        maxResponseTime,
        minResponseTime,
        samples: iterations,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /performance/cpu - Get CPU usage
 */
router.get("/performance/cpu", (req: Request, res: Response) => {
  const cpus = require("os").cpus();
  const avgLoad = require("os").loadavg();

  res.json({
    ok: true,
    cpu: {
      count: cpus.length,
      model: cpus[0]?.model || "unknown",
      speed: cpus[0]?.speed || 0,
      loadAverage: {
        "1min": avgLoad[0],
        "5min": avgLoad[1],
        "15min": avgLoad[2],
      },
      timestamp: Date.now(),
    },
  });
});

/**
 * POST /performance/bundle - Analyze bundle size
 */
router.post("/performance/bundle", async (req: Request, res: Response) => {
  const bundlePath = cleanText(req.body?.bundlePath, 500);

  if (!bundlePath) {
    return res.status(400).json({ error: "Bundle path required" });
  }

  try {
    const fs = require("fs");
    const stats = fs.statSync(bundlePath);

    return res.json({
      ok: true,
      bundle: {
        path: bundlePath,
        size: stats.size,
        sizeKB: (stats.size / 1024).toFixed(2),
        sizeMB: (stats.size / 1024 / 1024).toFixed(2),
        modified: new Date(stats.mtime).toISOString(),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
