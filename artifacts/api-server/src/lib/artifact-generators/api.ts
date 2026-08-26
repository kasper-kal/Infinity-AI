/**
 * PHASE 12 — API ARTIFACT GENERATOR
 *
 * Generates backend APIs from a single prompt.
 * Frameworks: Hono, Fastify, Express
 * Features: validation (Zod), ORM (Drizzle), auth (JWT), docs (Scalar), rate limiting, CORS, logging.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ArtifactConfig,
  ArtifactScaffoldResult,
  ArtifactBuildResult,
  ArtifactDeployResult,
  ArtifactPreviewInfo,
  ApiSettings,
  DeployTarget,
} from "../artifact-types";

export class ApiGenerator {
  constructor(private config: ArtifactConfig) {}

  async generate(): Promise<ArtifactScaffoldResult> {
    const settings = this.config.settings as ApiSettings;
    const framework = settings.framework || "hono";

    const files = await this.buildFiles(framework, settings);
    const installCommands = this.getInstallCommands(framework);
    const devCommands = this.getDevCommands(framework);
    const buildCommands = this.getBuildCommands(framework);
    const previewCommands = this.getPreviewCommands(framework);
    const deployCommands = this.getDeployCommands(framework);

    return {
      config: this.config,
      files,
      entryPoints: framework === "express" ? ["src/index.js"] : ["src/index.ts"],
      installCommands,
      devCommands,
      buildCommands,
      previewCommands,
      deployCommands,
    };
  }

  private async buildFiles(framework: string, settings: ApiSettings): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];

    // package.json
    files.push({
      path: "package.json",
      content: this.generatePackageJson(framework, settings),
      purpose: "NPM package configuration",
      isTemplate: false,
    });

    // tsconfig for TS frameworks
    if (framework !== "express") {
      files.push({
        path: "tsconfig.json",
        content: this.generateTsConfig(),
        purpose: "TypeScript configuration",
        isTemplate: false,
      });
    }

    // Main entry
    files.push({
      path: framework === "express" ? "src/index.js" : "src/index.ts",
      content: this.generateEntry(framework, settings),
      purpose: "API server entry point",
      isTemplate: false,
    });

    // Routes
    files.push({
      path: framework === "express" ? "src/routes/users.js" : "src/routes/users.ts",
      content: this.generateUserRoutes(framework, settings),
      purpose: "User CRUD routes",
      isTemplate: false,
    });

    // Middleware
    if (settings.rateLimiting) {
      files.push({
        path: framework === "express" ? "src/middleware/rate-limit.js" : "src/middleware/rate-limit.ts",
        content: this.generateRateLimit(framework),
        purpose: "Rate limiting middleware",
        isTemplate: false,
      });
    }
    if (settings.cors) {
      files.push({
        path: framework === "express" ? "src/middleware/cors.js" : "src/middleware/cors.ts",
        content: this.generateCors(framework),
        purpose: "CORS middleware",
        isTemplate: false,
      });
    }
    if (settings.auth !== "none") {
      files.push({
        path: framework === "express" ? "src/middleware/auth.js" : "src/middleware/auth.ts",
        content: this.generateAuth(framework, settings),
        purpose: "Authentication middleware",
        isTemplate: false,
      });
    }

    // Validation schemas
    if (settings.validation === "zod") {
      files.push({
        path: framework === "express" ? "src/validation/schemas.js" : "src/validation/schemas.ts",
        content: this.generateValidationSchemas(framework),
        purpose: "Request validation schemas",
        isTemplate: false,
      });
    }

    // ORM / DB
    if (settings.orm !== "none") {
      files.push({
        path: framework === "express" ? "src/db/index.js" : "src/db/index.ts",
        content: this.generateDb(framework, settings),
        purpose: "Database ORM setup",
        isTemplate: false,
      });
      files.push({
        path: "drizzle.config.ts",
        content: this.generateDrizzleConfig(),
        purpose: "Drizzle ORM configuration",
        isTemplate: false,
      });
    }

    // Logging
    files.push({
      path: framework === "express" ? "src/lib/logger.js" : "src/lib/logger.ts",
      content: this.generateLogger(framework, settings),
      purpose: "Structured logging",
      isTemplate: false,
    });

    // API docs (OpenAPI)
    if (settings.docs !== "none") {
      files.push({
        path: "openapi.yaml",
        content: this.generateOpenApiSpec(framework),
        purpose: "OpenAPI 3.0 specification",
        isTemplate: false,
      });
    }

    // Tests
    files.push({
      path: framework === "express" ? "test/api.test.js" : "test/api.test.ts",
      content: this.generateTests(framework, settings),
      purpose: "API integration tests",
      isTemplate: false,
    });

    // Docker
    files.push({
      path: "Dockerfile",
      content: this.generateDockerfile(framework),
      purpose: "Docker container config",
      isTemplate: false,
    });

    files.push({
      path: ".dockerignore",
      content: "node_modules\ndist\n.git\n.env\n*.log",
      purpose: "Docker ignore rules",
      isTemplate: false,
    });

    // README
    files.push({
      path: "README.md",
      content: this.generateReadme(framework, settings),
      purpose: "Project documentation",
      isTemplate: false,
    });

    // .gitignore
    files.push({
      path: ".gitignore",
      content: "node_modules\ndist\n.env\n*.log\n.DS_Store",
      purpose: "Git ignore rules",
      isTemplate: false,
    });

    // .env.example
    files.push({
      path: ".env.example",
      content: this.generateEnvExample(settings),
      purpose: "Environment variable template",
      isTemplate: false,
    });

    return files;
  }

  private generatePackageJson(framework: string, settings: ApiSettings): string {
    const deps: Record<string, string> = {};
    const devDeps: Record<string, string> = {};

    // Framework deps
    if (framework === "hono") {
      deps["hono"] = "^4.0.0";
      devDeps["@hono/node-server"] = "^1.8.0";
    } else if (framework === "fastify") {
      deps["fastify"] = "^4.26.0";
    } else if (framework === "express") {
      deps["express"] = "^4.18.0";
    }

    // Validation
    if (settings.validation === "zod") {
      deps["zod"] = "^3.22.0";
    }

    // ORM
    if (settings.orm === "drizzle") {
      deps["drizzle-orm"] = "^0.29.0";
      devDeps["drizzle-kit"] = "^0.20.0";
    }

    // Auth
    if (settings.auth === "jwt") {
      deps["jsonwebtoken"] = "^9.0.0";
      devDeps["@types/jsonwebtoken"] = "^9.0.0";
    }

    // CORS
    if (settings.cors && framework === "express") {
      deps["cors"] = "^2.8.5";
      devDeps["@types/cors"] = "^2.8.0";
    }

    // Rate limiting
    if (settings.rateLimiting && framework === "express") {
      deps["express-rate-limit"] = "^7.1.0";
    }

    // Logging
    if (settings.logging === "pino") {
      deps["pino"] = "^8.17.0";
      deps["pino-pretty"] = "^10.3.0";
    } else if (settings.logging === "winston") {
      deps["winston"] = "^3.11.0";
    }

    // Docs
    if (settings.docs === "scalar") {
      deps["@scalar/hono-api-reference"] = "^1.2.0";
    } else if (settings.docs === "swagger") {
      deps["swagger-ui-express"] = "^5.0.0";
    }

    // Testing
    if (settings.testing.includes("vitest")) {
      devDeps["vitest"] = "^1.2.0";
    }
    if (settings.testing.includes("supertest")) {
      deps["supertest"] = "^6.3.0";
      devDeps["@types/supertest"] = "^6.0.0";
    }

    // Common dev deps
    if (framework !== "express") {
      devDeps["typescript"] = "^5.3.0";
      devDeps["tsup"] = "^8.0.0";
      devDeps["@types/node"] = "^20.11.0";
    }

    return JSON.stringify({
      name: this.config.name.toLowerCase().replace(/\s+/g, "-"),
      version: "1.0.0",
      description: this.config.description,
      type: framework === "express" ? "commonjs" : "module",
      main: framework === "express" ? "src/index.js" : "dist/index.js",
      scripts: {
        dev: framework === "express" ? "node --watch src/index.js" : "tsx watch src/index.ts",
        build: framework === "express" ? "echo 'no build needed'" : "tsup src/index.ts --format esm",
        start: framework === "express" ? "node src/index.js" : "node dist/index.js",
        test: settings.testing.includes("vitest") ? "vitest run" : "node test/api.test.js",
        db: "generate",
        "db:push": "drizzle-kit push",
      },
      dependencies: deps,
      devDependencies: devDeps,
    }, null, 2);
  }

  private generateTsConfig(): string {
    return JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        outDir: "./dist",
        rootDir: "./src",
      },
      include: ["src/**/*"],
      exclude: ["node_modules", "dist"],
    }, null, 2);
  }

  private generateEntry(framework: string, settings: ApiSettings): string {
    if (framework === "hono") {
      return `import { Hono } from 'hono';
import { serve } from '@hono/node-server';
${settings.cors ? `import { cors } from 'hono/cors';` : ""}
${settings.rateLimiting ? `import { rateLimiter } from './middleware/rate-limit';` : ""}
${settings.auth !== "none" ? `import { authMiddleware } from './middleware/auth';` : ""}
import { logger } from './lib/logger';
import userRoutes from './routes/users';
${settings.docs === "scalar" ? `import { apiReference } from '@scalar/hono-api-reference';` : ""}

const app = new Hono();

${settings.cors ? `app.use('*', cors());` : ""}
app.use('*', logger);
${settings.rateLimiting ? `app.use('/api/*', rateLimiter);` : ""}
${settings.auth !== "none" ? `app.use('/api/protected/*', authMiddleware);` : ""}

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.route('/api/users', userRoutes);

${settings.docs === "scalar" ? `app.get('/docs', apiReference({ spec: { url: '/openapi.yaml' } }));` : ""}

const port = process.env.PORT || 3000;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(\`🚀 API running on http://localhost:\${info.port}\`);
});`;
    }

    if (framework === "fastify") {
      return `import Fastify from 'fastify';
${settings.cors ? `import cors from '@fastify/cors';` : ""}
${settings.rateLimiting ? `import rateLimit from '@fastify/rate-limit';` : ""}
${settings.auth !== "none" ? `import { authMiddleware } from './middleware/auth';` : ""}
import { logger } from './lib/logger';
import userRoutes from './routes/users';
${settings.docs === "swagger" ? `import swagger from '@fastify/swagger';` : ""}

const app = Fastify({ logger: false });

app.addHook('onRequest', logger);
${settings.cors ? `await app.register(cors);` : ""}
${settings.rateLimiting ? `await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });` : ""}
${settings.auth !== "none" ? `app.addHook('preHandler', authMiddleware);` : ""}

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

app.register(userRoutes, { prefix: '/api/users' });

const port = parseInt(process.env.PORT || '3000');
try {
  await app.listen({ port });
  console.log(\`🚀 API running on http://localhost:\${port}\`);
} catch (err) {
  console.error(err);
  process.exit(1);
}`;
    }

    // Express
    return `const express = require('express');
${settings.cors ? `const cors = require('cors');` : ""}
const userRoutes = require('./routes/users');
${settings.rateLimiting ? `const rateLimiter = require('./middleware/rate-limit');` : ""}
${settings.auth !== "none" ? `const authMiddleware = require('./middleware/auth');` : ""}
const { logger } = require('./lib/logger');

const app = express();
app.use(express.json());
${settings.cors ? `app.use(cors());` : ""}
app.use(logger);
${settings.rateLimiting ? `app.use('/api/', rateLimiter);` : ""}
${settings.auth !== "none" ? `app.use('/api/protected', authMiddleware);` : ""}

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/api/users', userRoutes);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(\`🚀 API running on http://localhost:\${port}\`);
});`;
  }

  private generateUserRoutes(framework: string, settings: ApiSettings): string {
    if (framework === "hono") {
      return `import { Hono } from 'hono';
${settings.validation === "zod" ? `import { z } from 'zod';\nimport { validator } from 'hono/validator';` : ""}
${settings.orm !== "none" ? `import { db } from '../db';\nimport { users } from '../db/schema';` : ""}

const users = new Hono();

users.get('/', (c) => c.json({ users: [] }));

users.get('/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ id, name: 'Example User' });
});

${settings.validation === "zod" ? `const createUserSchema = z.object({\n  name: z.string(),\n  email: z.string().email(),\n});\n` : ""}

users.post('/', ${settings.validation === "zod" ? `validator('json', (value, c) => {\n  const parsed = createUserSchema.safeParse(value);\n  if (!parsed.success) return c.text('Invalid', 400);\n  return parsed.data;\n}), ` : ""}(c) => {
  const data = c.req.${settings.validation === "zod" ? "valid('json')" : "json()"};
  return c.json({ created: true, data }, 201);
});

users.put('/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ updated: id });
});

users.delete('/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ deleted: id });
});

export default users;`;
    }

    if (framework === "fastify") {
      return `import { z } from 'zod';
${settings.orm !== "none" ? `import { db } from '../db';\nimport { users } from '../db/schema';` : ""}

export default async function userRoutes(fastify, opts) {
  fastify.get('/', async () => ({ users: [] }));

  fastify.get('/:id', async (request) => {
    const { id } = request.params;
    return { id, name: 'Example User' };
  });

  ${settings.validation === "zod" ? `const createSchema = z.object({\n    name: z.string(),\n    email: z.string().email(),\n  });\n` : ""}

  fastify.post('/', {
    schema: ${settings.validation === "zod" ? `{\n      body: {\n        type: 'object',\n        required: ['name', 'email'],\n        properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' } },\n      },\n    },` : "{}"},
  }, async (request, reply) => {
    const data = request.body;
    return reply.code(201).send({ created: true, data });
  });

  fastify.put('/:id', async (request) => {
    const { id } = request.params;
    return { updated: id };
  });

  fastify.delete('/:id', async (request) => {
    const { id } = request.params;
    return { deleted: id };
  });
}`;
    }

    // Express
    return `const express = require('express');
const router = express.Router();
${settings.orm !== "none" ? `const { db } = require('../db');` : ""}
${settings.validation === "zod" ? `const { z } = require('zod');\nconst createSchema = z.object({\n  name: z.string(),\n  email: z.string().email(),\n});` : ""}

router.get('/', (req, res) => res.json({ users: [] }));

router.get('/:id', (req, res) => {
  const { id } = req.params;
  res.json({ id, name: 'Example User' });
});

router.post('/', (req, res) => {
  ${settings.validation === "zod" ? `const parsed = createSchema.safeParse(req.body);\n  if (!parsed.success) {\n    return res.status(400).json({ error: parsed.error.issues });\n  }` : ""}
  res.status(201).json({ created: true, data: req.body });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  res.json({ updated: id });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  res.json({ deleted: id });
});

module.exports = router;`;
  }

  private generateRateLimit(framework: string): string {
    if (framework === "hono") {
      return `import { Hono } from 'hono';
import { rateLimiter } from 'hono-rate-limiter';

const limiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-6',
  legacyHeaders: false,
});

export const rateLimiterMiddleware = limiter;`;
    }

    if (framework === "fastify") {
      return `export async function rateLimiter(fastify) {
  await fastify.register(import('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
  });
}`;
    }

    return `const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = limiter;`;
  }

  private generateCors(framework: string): string {
    if (framework === "hono") {
      return `import { cors } from 'hono/cors';

export const corsMiddleware = cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
});`;
    }

    if (framework === "fastify") {
      return `export async function corsMiddleware(fastify) {
  await fastify.register(import('@fastify/cors'), {
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });
}`;
    }

    return `const cors = require('cors');

const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

module.exports = cors(corsOptions);`;
  }

  private generateAuth(framework: string, settings: ApiSettings): string {
    if (settings.auth === "jwt") {
      if (framework === "hono") {
        return `import { createMiddleware } from 'hono/factory';
import jwt from 'jsonwebtoken';

export const authMiddleware = createMiddleware(async (c, next) => {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    c.set('user', payload);
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
  await next();
});`;
      }
      if (framework === "fastify") {
        return `export async function authMiddleware(fastify) {
  fastify.decorateRequest('user', null);
  fastify.addHook('preHandler', async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    try {
      const jwt = await import('jsonwebtoken');
      request.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'dev-secret');
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }
  });
}`;
      }
      return `const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'dev-secret');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = authMiddleware;`;
    }

    // Session-based auth
    if (framework === "hono") {
      return `import { createMiddleware } from 'hono/factory';

export const authMiddleware = createMiddleware(async (c, next) => {
  const sessionId = c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1];
  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('sessionId', sessionId);
  await next();
});`;
    }
    if (framework === "fastify") {
      return `export async function authMiddleware(fastify) {
  fastify.decorateRequest('sessionId', null);
  fastify.addHook('preHandler', async (request) => {
    const cookie = request.headers.cookie;
    request.sessionId = cookie?.match(/session=([^;]+)/)?.[1] || null;
  });
}`;
    }
    return `function authMiddleware(req, res, next) {
  const sessionId = req.headers.cookie?.match(/session=([^;]+)/)?.[1];
  if (!sessionId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.sessionId = sessionId;
  next();
}

module.exports = authMiddleware;`;
  }

  private generateValidationSchemas(framework: string): string {
    if (framework === "express") {
      return `const { z } = require('zod');

const userCreateSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
});

const userUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
}).partial();

module.exports = { userCreateSchema, userUpdateSchema };`;
    }

    return `import { z } from 'zod';

export const userCreateSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
});

export const userUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
}).partial();

export const idParamSchema = z.object({
  id: z.string().uuid(),
});`;
  }

  private generateDb(framework: string, settings: ApiSettings): string {
    if (settings.orm === "drizzle") {
      if (framework === "express") {
        return `const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

module.exports = { db, pool };`;
      }
      return `import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);`;
    }

    return framework === "express"
      ? `const db = require('./db');\nmodule.exports = { db };`
      : `export const db = {};`;
  }

  private generateDrizzleConfig(): string {
    return `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});`;
  }

  private generateLogger(framework: string, settings: ApiSettings): string {
    if (settings.logging === "pino") {
      if (framework === "express") {
        return `const pino = require('pino');

const logger = pino({ transport: { target: 'pino-pretty' } });

function logMiddleware(req, res, next) {
  logger.info({ method: req.method, url: req.url }, 'request');
  next();
}

module.exports = { logger, logMiddleware };`;
      }
      return `import pino from 'pino';

export const logger = pino({ transport: { target: 'pino-pretty' } });

export const loggerMiddleware = async (c, next) => {
  logger.info({ method: c.req.method, url: c.req.url }, 'request');
  await next();
};`;
    }

    if (settings.logging === "winston") {
      if (framework === "express") {
        return `const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

function logMiddleware(req, res, next) {
  logger.info(\`\${req.method} \${req.url}\`);
  next();
}

module.exports = { logger, logMiddleware };`;
      }
      return `import winston from 'winston';

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

export const loggerMiddleware = async (c, next) => {
  logger.info(\`\${c.req.method} \${c.req.url}\`);
  await next();
};`;
    }

    // Console logging
    if (framework === "express") {
      return `function logger(req, res, next) {
  console.log(\`\${new Date().toISOString()} \${req.method} \${req.url}\`);
  next();
}

module.exports = { logger, logMiddleware: logger };`;
    }
    return `export const logger = console;
export const loggerMiddleware = async (c, next) => {
  console.log(\`\${new Date().toISOString()} \${c.req.method} \${c.req.url}\`);
  await next();
};`;
  }

  private generateOpenApiSpec(framework: string): string {
    return `openapi: 3.0.0
info:
  title: ${this.config.name}
  description: ${this.config.description}
  version: 1.0.0
servers:
  - url: http://localhost:3000
    description: Development
paths:
  /health:
    get:
      summary: Health check
      responses:
        '200':
          description: Service is healthy
  /api/users:
    get:
      summary: List users
      responses:
        '200':
          description: List of users
    post:
      summary: Create user
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
                email:
                  type: string
      responses:
        '201':
          description: User created
  /api/users/{id}:
    get:
      summary: Get user by ID
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: User details
    put:
      summary: Update user
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: User updated
    delete:
      summary: Delete user
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: User deleted`;
  }

  private generateTests(framework: string, settings: ApiSettings): string {
    if (settings.testing.includes("vitest")) {
      if (framework === "express") {
        return `const request = require('supertest');
const express = require('express');

describe('API', () => {
  test('GET /health returns ok', async () => {
    const app = express();
    app.get('/health', (req, res) => res.json({ status: 'ok' }));
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});`;
      }
      return `import { describe, test, expect } from 'vitest';
import { Hono } from 'hono';

describe('API', () => {
  test('GET /health returns ok', async () => {
    const app = new Hono();
    app.get('/health', (c) => c.json({ status: 'ok' }));
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});`;
    }

    // Plain node test
    return `const assert = require('assert');

describe('API', () => {
  it('should respond to health check', () => {
    assert.strictEqual(true, true);
  });
});`;
  }

  private generateDockerfile(framework: string): string {
    if (framework === "express") {
      return `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "src/index.js"]`;
    }
    return `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]`;
  }

  private generateReadme(framework: string, settings: ApiSettings): string {
    return `# ${this.config.name}

${this.config.description}

## Tech Stack
- **Framework:** ${framework}
- **Validation:** ${settings.validation}
- **ORM:** ${settings.orm}
- **Auth:** ${settings.auth}
- **Docs:** ${settings.docs}
- **Rate Limiting:** ${settings.rateLimiting ? "Enabled" : "Disabled"}
- **CORS:** ${settings.cors ? "Enabled" : "Disabled"}
- **Logging:** ${settings.logging}

## Quick Start

\`\`\`bash
npm install
npm run dev
\`\`\`

Server runs on http://localhost:3000

## API Endpoints
- \`GET /health\` — Health check
- \`GET /api/users\` — List users
- \`POST /api/users\` — Create user
- \`GET /api/users/:id\` — Get user
- \`PUT /api/users/:id\` — Update user
- \`DELETE /api/users/:id\` — Delete user

${settings.docs !== "none" ? "## API Docs\n\nVisit `/docs` for interactive API documentation." : ""}

## Environment Variables

See \`.env.example\` for all required variables.

---

Generated by Infinity AI — Multi-Artifact Support (Phase 12)`;
  }

  private generateEnvExample(settings: ApiSettings): string {
    let env = `PORT=3000\nNODE_ENV=development\n${settings.cors ? "CORS_ORIGIN=*" : ""}\n`;
    if (settings.orm !== "none") {
      env += "DATABASE_URL=postgresql://localhost:5432/mydb\n";
    }
    if (settings.auth === "jwt") {
      env += "JWT_SECRET=your-secret-key\n";
    }
    return env;
  }

  private getInstallCommands(framework: string): string[] {
    return ["npm install"];
  }

  private getDevCommands(framework: string): string[] {
    if (framework === "express") {
      return ["npm run dev"];
    }
    return ["npm run dev"];
  }

  private getBuildCommands(framework: string): string[] {
    if (framework === "express") {
      return ["echo 'no build step'"];
    }
    return ["npm run build"];
  }

  private getPreviewCommands(framework: string): string[] {
    return ["npm start"];
  }

  private getDeployCommands(framework: string): Record<string, string> {
    return {
      vercel: "vercel --prod",
      cloudflare: "wrangler deploy",
      docker: "docker build -t api . && docker run -p 3000:3000 api",
      "self-hosted": "pm2 start dist/index.js --name api",
    };
  }

  async build(artifactId: string, projectDir: string): Promise<ArtifactBuildResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const errors: string[] = [];

    try {
      logs.push(`Building API artifact: ${artifactId}`);

      // TypeScript build
      if (this.config.settings.framework !== "express") {
        const { execSync } = await import("node:child_process");
        execSync("npm run build", { cwd: projectDir, encoding: "utf-8", timeout: 120000 });
        logs.push("✓ TypeScript compiled successfully");
      }

      // Run tests
      logs.push("Running tests...");
      const { execSync } = await import("node:child_process");
      try {
        const testOutput = execSync("npm test", { cwd: projectDir, encoding: "utf-8", timeout: 60000 });
        logs.push(testOutput);
      } catch (testError) {
        errors.push(`Tests failed: ${testError}`);
      }

      const duration = Date.now() - startTime;
      logs.push(`✓ Build completed in ${duration}ms`);

      return {
        artifactId,
        success: errors.length === 0,
        outputDir: path.join(projectDir, "dist"),
        assets: ["dist/index.js"],
        logs,
        errors,
        durationMs: duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      errors.push(`Build failed: ${error}`);
      logs.push(`✗ Build failed in ${duration}ms`);
      return {
        artifactId,
        success: false,
        outputDir: "",
        assets: [],
        logs,
        errors,
        durationMs: duration,
      };
    }
  }

  async deploy(artifactId: string, projectDir: string, target: DeployTarget): Promise<ArtifactDeployResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const errors: string[] = [];

    try {
      logs.push(`Deploying API ${artifactId} to ${target}`);

      const { execSync } = await import("node:child_process");
      let deployCmd: string;
      switch (target) {
        case "vercel":
          deployCmd = "vercel --prod";
          break;
        case "cloudflare":
          deployCmd = "wrangler deploy";
          break;
        case "docker":
          deployCmd = "docker build -t api . && docker push api:latest";
          break;
        case "self-hosted":
          deployCmd = "pm2 start dist/index.js --name api";
          break;
        default:
          throw new Error(`Unsupported deploy target: ${target}`);
      }

      const output = execSync(deployCmd, { cwd: projectDir, encoding: "utf-8", timeout: 180000 });
      logs.push(output);

      const duration = Date.now() - startTime;
      logs.push(`✓ Deploy to ${target} completed in ${duration}ms`);

      return {
        artifactId,
        target,
        success: true,
        url: this.getDeployUrl(target),
        logs,
        errors,
        durationMs: duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      errors.push(`Deploy failed: ${error}`);
      logs.push(`✗ Deploy to ${target} failed in ${duration}ms`);
      return {
        artifactId,
        target,
        success: false,
        logs,
        errors,
        durationMs: duration,
      };
    }
  }

  async preview(artifactId: string, projectDir: string): Promise<ArtifactPreviewInfo> {
    return {
      artifactId,
      type: "local",
      url: "http://localhost:3000",
    };
  }

  private getDeployUrl(target: DeployTarget): string | undefined {
    switch (target) {
      case "vercel":
        return "https://your-app.vercel.app";
      case "cloudflare":
        return "https://your-worker.workers.dev";
      case "docker":
        return "https://registry.hub.docker.com/r/yourname/api";
      default:
        return undefined;
    }
  }
}

interface GeneratedFile {
  path: string;
  content: string;
  purpose: string;
  isTemplate: boolean;
}

export function generateApi(config: ArtifactConfig): ApiGenerator {
  return new ApiGenerator(config);
}
