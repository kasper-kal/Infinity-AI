/**
 * Serverless Function Generator
 *
 * Generates API routes alongside UI components:
 * - Next.js API routes (pages/api, app/api)
 * - Edge Functions (Next.js Middleware, Vercel Edge)
 * - Cloudflare Workers
 * - Type-safe request/response validation with Zod
 * - Deployed with UI (same preview URL)
 */

import { z } from 'zod';

// ============================================================================
// Function Generator Types
// ============================================================================

export const FunctionTargetSchema = z.enum([
  'nextjs-pages',
  'nextjs-app',
  'nextjs-edge',
  'vercel-edge',
  'cloudflare-workers',
  'netlify-functions',
]);

export const FunctionConfigSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100),
  path: z.string(), // e.g., /api/users, /api/posts/[id]
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
  target: FunctionTargetSchema,
  requestSchema: z.any().optional(), // Zod schema for request body
  responseSchema: z.any().optional(), // Zod schema for response
  querySchema: z.any().optional(), // Zod schema for query params
  paramsSchema: z.any().optional(), // Zod schema for path params
  handler: z.string().optional(), // Custom handler code
  auth: z.object({
    required: z.boolean().default(false),
    provider: z.enum(['clerk', 'authjs', 'supabase', 'firebase', 'custom-jwt', 'none']).default('none'),
  }).optional(),
  rateLimit: z.object({
    max: z.number().default(100),
    windowMs: z.number().default(60000),
  }).optional(),
  cors: z.boolean().default(true),
  environment: z.record(z.string()).optional(),
});

export const GeneratedFunctionSchema = z.object({
  name: z.string(),
  path: z.string(),
  method: z.string(),
  target: FunctionTargetSchema,
  filePath: z.string(),
  code: z.string(),
  types: z.array(z.object({
    name: z.string(),
    content: z.string(),
  })),
  dependencies: z.array(z.string()).default([]),
});

export type FunctionTarget = z.infer<typeof FunctionTargetSchema>;
export type FunctionConfig = z.infer<typeof FunctionConfigSchema>;
export type GeneratedFunction = z.infer<typeof GeneratedFunctionSchema>;

// ============================================================================
// Function Generator Engine
// ============================================================================

export class FunctionGeneratorEngine {
  static async generate(config: FunctionConfig): Promise<GeneratedFunction> {
    const types = this.generateTypes(config);
    const code = this.generateCode(config, types);

    const targetConfig = this.getTargetConfig(config.target);
    const filePath = this.getFilePath(config, targetConfig);

    return {
      name: config.name,
      path: config.path,
      method: config.method,
      target: config.target,
      filePath,
      code,
      types,
      dependencies: this.getDependencies(config.target),
    };
  }

  static async generateComponentFunctionPair(
    componentConfig: {
      name: string;
      path: string;
      fields: Array<{ name: string; type: string; required?: boolean }>;
    },
    options: {
      target: FunctionTarget;
      operations: ('create' | 'read' | 'update' | 'delete' | 'list')[];
    }
  ): Promise<{ component: string; functions: GeneratedFunction[] }> {
    const functions: GeneratedFunction[] = [];

    for (const op of options.operations) {
      const method = this.operationToMethod(op);
      const fnConfig: FunctionConfig = {
        projectId: '',
        name: `${componentConfig.name}${op.charAt(0).toUpperCase() + op.slice(1)}`,
        path: op === 'list' ? componentConfig.path : `${componentConfig.path}/[id]`,
        method,
        target: options.target,
        requestSchema: op !== 'read' && op !== 'delete' ? this.fieldsToZodSchema(componentConfig.fields) : undefined,
        responseSchema: this.fieldsToZodSchema(componentConfig.fields),
        paramsSchema: op !== 'list' && op !== 'create' ? z.object({ id: z.string() }) : undefined,
      };

      const fn = await this.generate(fnConfig);
      functions.push(fn);
    }

    // Generate component that uses these functions
    const component = this.generateComponent(componentConfig, functions);

    return { component, functions };
  }

  private static generateTypes(config: FunctionConfig): Array<{ name: string; content: string }> {
    const types: Array<{ name: string; content: string }> = [];

    if (config.requestSchema) {
      types.push({
        name: `${config.name}Request`,
        content: this.zodToTS(config.requestSchema, `${config.name}Request`),
      });
    }

    if (config.responseSchema) {
      types.push({
        name: `${config.name}Response`,
        content: this.zodToTS(config.responseSchema, `${config.name}Response`),
      });
    }

    if (config.querySchema) {
      types.push({
        name: `${config.name}Query`,
        content: this.zodToTS(config.querySchema, `${config.name}Query`),
      });
    }

    if (config.paramsSchema) {
      types.push({
        name: `${config.name}Params`,
        content: this.zodToTS(config.paramsSchema, `${config.name}Params`),
      });
    }

    return types;
  }

  private static zodToTS(schema: z.ZodTypeAny, name: string): string {
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      const props = Object.entries(shape).map(([key, value]) => {
        const optional = value instanceof z.ZodOptional ? '?' : '';
        const tsType = this.zodTypeToTS(value);
        return `  ${key}${optional}: ${tsType};`;
      }).join('\n');
      return `export interface ${name} {\n${props}\n}`;
    }
    if (schema instanceof z.ZodArray) {
      return `export type ${name} = ${this.zodTypeToTS(schema.element)}[];`;
    }
    if (schema instanceof z.ZodOptional) {
      return `export type ${name} = ${this.zodTypeToTS(schema.unwrap())} | undefined;`;
    }
    return `export type ${name} = ${this.zodTypeToTS(schema)};`;
  }

  private static zodTypeToTS(schema: z.ZodTypeAny): string {
    if (schema instanceof z.ZodString) return 'string';
    if (schema instanceof z.ZodNumber) return 'number';
    if (schema instanceof z.ZodBoolean) return 'boolean';
    if (schema instanceof z.ZodDate) return 'Date | string';
    if (schema instanceof z.ZodArray) return `${this.zodTypeToTS(schema.element)}[]`;
    if (schema instanceof z.ZodObject) return 'Record<string, any>';
    if (schema instanceof z.ZodEnum) return schema.options.map(o => `"${o}"`).join(' | ');
    if (schema instanceof z.ZodNativeEnum) return Object.values(schema.enum).map(v => `"${v}"`).join(' | ');
    if (schema instanceof z.ZodOptional) return `${this.zodTypeToTS(schema.unwrap())} | undefined`;
    if (schema instanceof z.ZodNullable) return `${this.zodTypeToTS(schema.unwrap())} | null`;
    if (schema instanceof z.ZodUnion) return schema.options.map(o => this.zodTypeToTS(o)).join(' | ');
    return 'any';
  }

  private static fieldsToZodSchema(fields: Array<{ name: string; type: string; required?: boolean }>): z.ZodObject<any> {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const field of fields) {
      let type: z.ZodTypeAny;
      switch (field.type) {
        case 'string': type = z.string(); break;
        case 'number': type = z.number(); break;
        case 'boolean': type = z.boolean(); break;
        case 'date': type = z.string().datetime(); break;
        case 'email': type = z.string().email(); break;
        case 'uuid': type = z.string().uuid(); break;
        default: type = z.string();
      }
      shape[field.name] = field.required !== false ? type : type.optional();
    }
    return z.object(shape);
  }

  private static operationToMethod(op: string): 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' {
    switch (op) {
      case 'create': return 'POST';
      case 'read': return 'GET';
      case 'update': return 'PATCH';
      case 'delete': return 'DELETE';
      case 'list': return 'GET';
      default: return 'GET';
    }
  }

  private static getTargetConfig(target: FunctionTarget) {
    switch (target) {
      case 'nextjs-pages':
        return { dir: 'pages/api', extension: 'ts', export: 'export default' };
      case 'nextjs-app':
        return { dir: 'app/api', extension: 'ts', export: 'export async function' };
      case 'nextjs-edge':
        return { dir: 'middleware', extension: 'ts', export: 'export default' };
      case 'vercel-edge':
        return { dir: 'api', extension: 'ts', export: 'export default' };
      case 'cloudflare-workers':
        return { dir: 'functions', extension: 'ts', export: 'export default' };
      case 'netlify-functions':
        return { dir: 'netlify/functions', extension: 'ts', export: 'export default' };
    }
  }

  private static getFilePath(config: FunctionConfig, targetConfig: any): string {
    const path = config.path.replace(/^\/api/, '').replace(/\[([^\]]+)\]/g, '[$1]');
    return `${targetConfig.dir}${path}.${targetConfig.extension}`;
  }

  private static getDependencies(target: FunctionTarget): string[] {
    const base = ['zod'];
    switch (target) {
      case 'nextjs-pages':
      case 'nextjs-app':
        return [...base, 'next'];
      case 'nextjs-edge':
      case 'vercel-edge':
        return [...base, 'next'];
      case 'cloudflare-workers':
        return [...base, '@cloudflare/workers-types'];
      case 'netlify-functions':
        return [...base, '@netlify/functions'];
      default:
        return base;
    }
  }

  private static generateCode(config: FunctionConfig, types: Array<{ name: string; content: string }>): string {
    const targetConfig = this.getTargetConfig(config.target);
    const hasParams = config.paramsSchema !== undefined;
    const hasQuery = config.querySchema !== undefined;
    const hasBody = config.requestSchema !== undefined;

    const typeImports = types.map(t => `import type { ${t.name} } from './types';`).join('\n');

    // Generate validation middleware
    const validationCode = this.generateValidation(config);

    // Generate auth check
    const authCode = config.auth?.required && config.auth.provider !== 'none'
      ? this.generateAuthCheck(config.auth.provider)
      : '';

    // Generate rate limit
    const rateLimitCode = config.rateLimit
      ? this.generateRateLimit(config.rateLimit.max, config.rateLimit.windowMs)
      : '';

    // Generate CORS
    const corsCode = config.cors ? this.generateCORS() : '';

    // Main handler
    const handlerCode = config.handler || this.generateDefaultHandler(config);

    return `${typeImports}

${types.map(t => t.content).join('\n\n')}

// Validation schemas
${validationCode}

// Auth check
${authCode}

// Rate limiting
${rateLimitCode}

// CORS
${corsCode}

${targetConfig.export} async function handler(
  request: Request,
  { params }: { params: Promise<{ ${hasParams ? config.path.match(/\[([^\]]+)\]/g)?.map(p => p.slice(1, -1)).join(', ') : ''} }> }
): Promise<Response> {
  try {
    ${authCode ? 'await checkAuth(request);' : ''}
    ${rateLimitCode ? 'await checkRateLimit(request);' : ''}

    const url = new URL(request.url);
    ${hasQuery ? `const query = validateQuery(Object.fromEntries(url.searchParams));` : ''}
    ${hasParams ? `const params_ = await params;\nconst paramsValidated = validateParams(params_);` : ''}
    ${hasBody ? `const body = await request.json();\nconst validatedBody = validateBody(body);` : ''}

    ${handlerCode}

  } catch (error) {
    console.error('API Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
}

${corsCode ? `// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};` : ''}

${config.cors ? `
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}` : ''}
`;
  }

  private static generateValidation(config: FunctionConfig): string {
    const parts: string[] = [];

    if (config.requestSchema) {
      parts.push(`function validateBody(body: unknown): ${config.name}Request {
  const result = ${config.name}RequestSchema.safeParse(body);
  if (!result.success) {
    throw new Error('Invalid request body: ' + result.error.errors.map(e => e.message).join(', '));
  }
  return result.data;
}`);
    }

    if (config.querySchema) {
      parts.push(`function validateQuery(query: Record<string, string>): ${config.name}Query {
  const result = ${config.name}QuerySchema.safeParse(query);
  if (!result.success) {
    throw new Error('Invalid query parameters: ' + result.error.errors.map(e => e.message).join(', '));
  }
  return result.data;
}`);
    }

    if (config.paramsSchema) {
      parts.push(`function validateParams(params: Record<string, string>): ${config.name}Params {
  const result = ${config.name}ParamsSchema.safeParse(params);
  if (!result.success) {
    throw new Error('Invalid path parameters: ' + result.error.errors.map(e => e.message).join(', '));
  }
  return result.data;
}`);
    }

    return parts.join('\n\n');
  }

  private static generateAuthCheck(provider: string): string {
    switch (provider) {
      case 'clerk':
        return `async function checkAuth(request: Request): Promise<string> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }
  // In production, verify with Clerk SDK
  return authHeader.slice(7);
}`;
      case 'supabase':
        return `async function checkAuth(request: Request): Promise<any> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }
  // In production, verify with Supabase
  const token = authHeader.slice(7);
  return { id: 'user_from_token' };
}`;
      default:
        return `async function checkAuth(request: Request): Promise<any> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }
  return authHeader.slice(7);
}`;
    }
  }

  private static generateRateLimit(max: number, windowMs: number): string {
    return `const rateLimitStore = new Map<string, { count: number; reset: number }>();

async function checkRateLimit(request: Request): Promise<void> {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  const now = Date.now();
  const key = \`\${ip}:\${Math.floor(now / ${windowMs})}\`;

  const current = rateLimitStore.get(key) || { count: 0, reset: now + ${windowMs} };
  if (current.count >= ${max}) {
    throw new Error('Rate limit exceeded');
  }
  current.count++;
  rateLimitStore.set(key, current);

  // Cleanup old entries periodically
  if (rateLimitStore.size > 10000) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (v.reset < now) rateLimitStore.delete(k);
    }
  }
}`;
  }

  private static generateCORS(): string {
    return `function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}`;
  }

  private static generateDefaultHandler(config: FunctionConfig): string {
    const targetConfig = this.getTargetConfig(config.target);

    switch (config.method) {
      case 'GET':
        return `return new Response(
  JSON.stringify({ message: 'GET ${config.path}', data: null }),
  { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
);`;
      case 'POST':
        return `return new Response(
  JSON.stringify({ message: 'Created', data: validatedBody }),
  { status: 201, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
);`;
      case 'PUT':
      case 'PATCH':
        return `return new Response(
  JSON.stringify({ message: 'Updated', data: validatedBody }),
  { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
);`;
      case 'DELETE':
        return `return new Response(
  JSON.stringify({ message: 'Deleted' }),
  { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
);`;
      default:
        return `return new Response(
  JSON.stringify({ message: '${config.method} ${config.path}' }),
  { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
);`;
    }
  }

  private static generateComponent(componentConfig: any, functions: GeneratedFunction[]): string {
    const hooks = functions.map(fn => {
      const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(fn.method);
      return `  const ${fn.name} = use${isMutation ? 'Mutation' : 'Query'}<${fn.types[0]?.name || 'any'}>({
    mutationFn: async (data) => {
      const res = await fetch('${fn.path}', {
        method: '${fn.method}',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
  });`;
    }).join('\n');

    return `'use client';
import { useQuery, useMutation } from '@tanstack/react-query';

export function ${componentConfig.name}Component() {
${hooks}

  return (
    <div>
      <h2>${componentConfig.name}</h2>
      {/* Implement UI using the generated hooks */}
    </div>
  );
}`;
  }
}

// ============================================================================
// Validation
// ============================================================================

export function validateFunctionConfig(config: unknown): { valid: boolean; errors: string[] } {
  const result = FunctionConfigSchema.safeParse(config);
  return {
    valid: result.success,
    errors: result.success ? [] : result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}