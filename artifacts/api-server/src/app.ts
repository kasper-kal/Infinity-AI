import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { buildErrorDetail } from "./lib/error-detail";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

// Trust the first proxy (Replit, nginx, etc.) so req.ip reflects real client IP
app.set("trust proxy", 1);

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
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: "1gb" }));
app.use(express.urlencoded({ extended: true, limit: "1gb" }));

app.use("/api", router);

// ── Serve built frontend static files (production only) ──
// In development the Vite dev server handles the frontend; attempting to serve
// the unbuilt dist folder here would throw ENOENT and produce spurious 500s.
if (process.env["NODE_ENV"] !== "development") {
  const staticDir = path.resolve(__dirname, "..", "..", "..", "artifacts", "jarvis", "dist", "public");
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
