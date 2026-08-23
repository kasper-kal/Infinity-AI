import { Router, Request, Response } from "express";
import { chromium, firefox, webkit } from "playwright";
import { cleanText } from "../../lib/text-utils";

const router = Router();

interface BrowserCompatibilityResult {
  url: string;
  timestamp: number;
  browsers: {
    name: string;
    version: string;
    status: "success" | "partial" | "failed";
    issues: string[];
    features: {
      css: { supported: string[]; unsupported: string[] };
      javascript: { supported: string[]; unsupported: string[] };
      web: { supported: string[]; unsupported: string[] };
    };
  }[];
}

/**
 * POST /compatibility/test - Test website across browsers
 */
router.post("/compatibility/test", async (req: Request, res: Response) => {
  const url = cleanText(req.body?.url, 500) || "http://localhost:3000";
  const browsers = req.body?.browsers || ["chromium", "firefox", "webkit"];

  const result: BrowserCompatibilityResult = {
    url,
    timestamp: Date.now(),
    browsers: [],
  };

  const browserLaunchers: Record<string, any> = {
    chromium,
    firefox,
    webkit,
    chrome: chromium,
    safari: webkit,
  };

  try {
    for (const browserName of browsers) {
      const launcher = browserLaunchers[browserName.toLowerCase()];
      if (!launcher) continue;

      let browser;
      try {
        browser = await launcher.launch();
        const page = await browser.newPage();
        const issues: string[] = [];

        // Navigate to URL
        try {
          await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        } catch (err) {
          issues.push(`Navigation failed: ${(err as Error).message}`);
        }

        // Test JavaScript features
        const jsFeatures = await page.evaluate(() => {
          const features = {
            supported: [] as string[],
            unsupported: [] as string[],
          };

          // Test common JS features
          if (typeof Promise !== "undefined") features.supported.push("Promise");
          if (typeof Map !== "undefined") features.supported.push("Map");
          if (typeof Set !== "undefined") features.supported.push("Set");
          if (typeof Proxy !== "undefined") features.supported.push("Proxy");
          if (typeof Symbol !== "undefined") features.supported.push("Symbol");

          return features;
        });

        // Test CSS features
        const cssFeatures = await page.evaluate(() => {
          const features = {
            supported: [] as string[],
            unsupported: [] as string[],
          };

          const testProps = ["display: flex", "display: grid", "backdrop-filter: blur(10px)"];

          testProps.forEach((prop) => {
            const el = document.createElement("div");
            el.style.cssText = prop;
            if (el.style.length > 0) {
              features.supported.push(prop.split(":")[0]);
            } else {
              features.unsupported.push(prop.split(":")[0]);
            }
          });

          return features;
        });

        // Test Web APIs
        const webFeatures = await page.evaluate(() => {
          const features = {
            supported: [] as string[],
            unsupported: [] as string[],
          };

          if ("localStorage" in window) features.supported.push("localStorage");
          if ("sessionStorage" in window) features.supported.push("sessionStorage");
          if ("indexedDB" in window) features.supported.push("indexedDB");
          if ("WebSocket" in window) features.supported.push("WebSocket");
          if ("fetch" in window) features.supported.push("fetch");
          if ("ServiceWorkerContainer" in window) features.supported.push("Service Workers");

          return features;
        });

        result.browsers.push({
          name: browserName,
          version: "latest",
          status: issues.length === 0 ? "success" : issues.length < 3 ? "partial" : "failed",
          issues,
          features: {
            css: cssFeatures,
            javascript: jsFeatures,
            web: webFeatures,
          },
        });

        await browser.close();
      } catch (err) {
        if (browser) await browser.close();
        result.browsers.push({
          name: browserName,
          version: "latest",
          status: "failed",
          issues: [(err as Error).message],
          features: {
            css: { supported: [], unsupported: [] },
            javascript: { supported: [], unsupported: [] },
            web: { supported: [], unsupported: [] },
          },
        });
      }
    }

    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /compatibility/feature-detection - Get feature detection tests
 */
router.get("/compatibility/feature-detection", (req: Request, res: Response) => {
  const features = [
    {
      name: "CSS Grid",
      detection: "CSS.supports('display: grid')",
      fallback: "Use CSS Flexbox",
      browser: "Chrome 57+, Firefox 52+, Safari 10.1+",
    },
    {
      name: "CSS Flexbox",
      detection: "CSS.supports('display: flex')",
      fallback: "Use CSS float or table layout",
      browser: "All modern browsers",
    },
    {
      name: "LocalStorage",
      detection: "'localStorage' in window",
      fallback: "Use cookies or session storage",
      browser: "All modern browsers",
    },
    {
      name: "WebSocket",
      detection: "'WebSocket' in window",
      fallback: "Use Server-Sent Events or polling",
      browser: "All modern browsers",
    },
    {
      name: "Service Workers",
      detection: "'serviceWorker' in navigator",
      fallback: "No offline support",
      browser: "Chrome 40+, Firefox 44+, Safari 11.1+",
    },
    {
      name: "Fetch API",
      detection: "'fetch' in window",
      fallback: "Use XMLHttpRequest",
      browser: "All modern browsers",
    },
    {
      name: "Promises",
      detection: "'Promise' in window",
      fallback: "Use callbacks or async/await transpiling",
      browser: "All modern browsers",
    },
    {
      name: "Arrow Functions",
      detection: "() => {} syntax support",
      fallback: "Use function() syntax",
      browser: "Chrome 45+, Firefox 22+, Safari 10+",
    },
  ];

  res.json({ ok: true, features });
});

/**
 * POST /compatibility/polyfill-check - Check for needed polyfills
 */
router.post("/compatibility/polyfill-check", (req: Request, res: Response) => {
  const targetBrowsers = req.body?.targetBrowsers || ["Chrome 90+", "Firefox 88+", "Safari 14+"];

  const polyfillsNeeded = [];

  // Check for different browser requirements
  if (targetBrowsers.some((b: string) => b.includes("IE"))) {
    polyfillsNeeded.push({
      name: "IE11 Support",
      polyfills: [
        "@babel/polyfill",
        "promise-polyfill",
        "fetch-polyfill",
        "intersection-observer",
      ],
      npm: "npm install @babel/polyfill",
    });
  }

  if (targetBrowsers.some((b: string) => b.includes("Safari 10") || b.includes("Safari 11"))) {
    polyfillsNeeded.push({
      name: "Safari 10-11 Support",
      polyfills: ["core-js", "regenerator-runtime"],
      npm: "npm install core-js regenerator-runtime",
    });
  }

  res.json({
    ok: true,
    targetBrowsers,
    polyfillsNeeded,
    recommendation: "Test in real browsers and add polyfills only if needed",
  });
});

/**
 * GET /compatibility/browser-matrix - Get browser support matrix
 */
router.get("/compatibility/browser-matrix", (req: Request, res: Response) => {
  const matrix = {
    browsers: [
      { name: "Chrome", version: "Latest", market: "65%" },
      { name: "Firefox", version: "Latest", market: "10%" },
      { name: "Safari", version: "Latest", market: "18%" },
      { name: "Edge", version: "Latest", market: "4%" },
      { name: "IE 11", version: "11", market: "2%" },
    ],
    featureSupport: {
      "CSS Grid": {
        Chrome: "57+",
        Firefox: "52+",
        Safari: "10.1+",
        Edge: "16+",
        IE: "No",
      },
      "CSS Flexbox": {
        Chrome: "29+",
        Firefox: "28+",
        Safari: "9+",
        Edge: "12+",
        IE: "11",
      },
      "ES6 Classes": {
        Chrome: "49+",
        Firefox: "45+",
        Safari: "9+",
        Edge: "13+",
        IE: "No",
      },
      Promises: {
        Chrome: "32+",
        Firefox: "29+",
        Safari: "8+",
        Edge: "12+",
        IE: "No",
      },
      WebSocket: {
        Chrome: "16+",
        Firefox: "11+",
        Safari: "7+",
        Edge: "12+",
        IE: "10+",
      },
    },
  };

  res.json({ ok: true, matrix });
});

export default router;
