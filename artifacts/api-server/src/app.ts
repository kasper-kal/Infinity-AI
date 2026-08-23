import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { buildErrorDetail } from "./lib/error-detail";
import { requireAuth, optionalAuth } from "./middleware/auth-middleware";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

// Trust the first proxy (Replit, nginx, etc.) so req.ip reflects real client IP
app.set("trust proxy", 1);

// Per-route body parsers (replaces global 1GB limit - security fix)
const json1mb = express.json({ limit: "1mb" });
const json10mb = express.json({ limit: "10mb" });
const json50mb = express.json({ limit: "50mb" });
const urlencoded1mb = express.urlencoded({ extended: true, limit: "1mb" });
const urlencoded10mb = express.urlencoded({ extended: true, limit: "10mb" });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS configuration - security fix: restrict origins
const allowedOrigins = process.env.NODE_ENV === "production"
  ? [process.env.FRONTEND_URL].filter((v): v is string => Boolean(v))
  : ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173"];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
}));
app.use(cookieParser());
// Note: body parsers now applied per-route below

// Public router for endpoints that don't require authentication
const publicRouter = express.Router();

// Mount public endpoints BEFORE auth middleware
// These must be explicitly listed as public
publicRouter.use("/auth", urlencoded1mb, (await import("./routes/infinity/auth")).default);
publicRouter.use("/health", (await import("./routes/health")).default);
publicRouter.use("/extension", (await import("./routes/infinity/extension")).default);

// Apply public routes
app.use("/api", publicRouter);

// Global authentication middleware - protects all remaining /api routes
app.use("/api", requireAuth);

// Main router (all routes now require auth by default)
// Apply per-route body parsers based on endpoint category
// /chat, /memory, /research → 1mb
// /build/* → 10mb
// /files/*, /import/upload → multer
// /data/import → 50mb
app.use("/api/infinity/chat", json1mb, urlencoded1mb);
app.use("/api/infinity/memories", json1mb, urlencoded1mb);
app.use("/api/infinity/project-memories", json1mb, urlencoded1mb);
app.use("/api/infinity/research", json1mb, urlencoded1mb);
app.use("/api/infinity/build", json10mb, urlencoded10mb);
app.use("/api/infinity/build-checkpoints", json10mb, urlencoded10mb);
app.use("/api/infinity/build-telemetry", json10mb, urlencoded10mb);
app.use("/api/infinity/build-export", json10mb, urlencoded10mb);
app.use("/api/infinity/build-schedules", json10mb, urlencoded10mb);
app.use("/api/files", upload.any()); // multipart for file uploads
app.use("/api/import", upload.any()); // multipart for archive imports
// For data import endpoints if they exist
app.use("/api/infinity/data", json50mb, urlencoded10mb);
// Default for all other infinity routes: 1mb
app.use("/api/infinity", json1mb, urlencoded1mb);
app.use("/api", router);

// ── Serve built frontend static files (production only) ──
// In development the Vite dev server handles the frontend; attempting to serve
// the unbuilt dist folder here would throw ENOENT and produce spurious 500s.
if (process.env["NODE_ENV"] !== "development") {
  const staticDir = path.resolve(__dirname, "..", "..", "..", "artifacts", "infinity", "dist", "public");
  app.use(express.static(staticDir));

  // ── SPA fallback, any non-API, non-static request serves index.html ──
  app.use((req: Request, res: Response) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
} else {
  // In development: return a clean 404 for any non-API route instead of crashing
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found (dev mode: frontend is served by Vite)" });
  });
}

// ── Global error handler, catches any unhandled errors and returns detailed info ──
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled error");
  const detail = buildErrorDetail(err, req, 500, Date.now());
  res.status(500).json({ error: "Internal server error", detail });
});

export default app;
