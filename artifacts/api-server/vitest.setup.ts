import { vi } from "vitest";

// Mock adapter-factory before any module imports it
vi.mock("./src/lib/adapter-factory", () => ({
  createBestAdapter: vi.fn().mockResolvedValue({
    complete: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        steps: [
          { action: "navigate", url: "https://example.com", wait: 3000, description: "Opening homepage...", section: "hook", textStyle: "title", textPosition: "center" },
          { action: "click", selector: "button#demo", delay: 500, description: "Clicking demo...", section: "demo", textStyle: "body", textPosition: "bottom" },
        ],
        estimatedDuration: 5,
        targetDuration: 5,
        sections: {
          hook: [{ action: "navigate", url: "https://example.com", wait: 3000, description: "Opening homepage...", section: "hook", textStyle: "title", textPosition: "center" }],
          demo: [{ action: "click", selector: "button#demo", delay: 500, description: "Clicking demo...", section: "demo", textStyle: "body", textPosition: "bottom" }],
          cta: [],
        },
      }),
    }),
  }),
}));

// Mock puppeteer
vi.mock("puppeteer", () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn(),
        $: vi.fn().mockResolvedValue({
          boundingBox: vi.fn().mockResolvedValue({ x: 100, y: 100, width: 200, height: 50 }),
          click: vi.fn(),
          hover: vi.fn(),
        }),
        evaluate: vi.fn(),
        target: vi.fn().mockReturnValue({
          createCDPSession: vi.fn().mockResolvedValue({
            send: vi.fn(),
            on: vi.fn(),
          }),
        }),
        keyboard: { type: vi.fn() },
      }),
      close: vi.fn(),
    }),
  },
}));

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn().mockImplementation((cmd, args) => ({
    on: (event, cb) => {
      if (event === "close") setTimeout(() => cb(0), 10);
      if (event === "error") setTimeout(() => cb(null), 10);
    },
  })),
}));

// Mock fs
vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  rmSync: vi.fn(),
}));

// Mock fetch
vi.mock("fetch", () => ({
  default: vi.fn().mockResolvedValue({
    ok: true,
    text: vi.fn().mockResolvedValue(""),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
  }),
}));