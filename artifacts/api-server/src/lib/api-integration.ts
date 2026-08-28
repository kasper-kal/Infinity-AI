/**
 * API Integration Engine
 *
 * Parses external API schemas (OpenAPI/GraphQL/tRPC) and generates:
 * - TypeScript types
 * - TanStack Query / urql / tRPC hooks
 * - Ready-to-use React components for data fetching
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';

// ============================================================================
// API Integration Types
// ============================================================================

export const APIProviderSchema = z.enum([
  'rest',
  'graphql',
  'trpc',
]);

export const APISpecSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100),
  provider: APIProviderSchema,
  spec: z.string(), // Raw OpenAPI JSON/YAML, GraphQL SDL, or tRPC router definition
  baseUrl: z.string().url().optional(),
  auth: z.object({
    type: z.enum(['bearer', 'api-key', 'basic', 'none']).default('none'),
    headerName: z.string().optional(),
    headerValue: z.string().optional(),
  }).optional(),
  headers: z.record(z.string()).optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export const ParsedEndpointSchema = z.object({
  path: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
  operationId: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  parameters: z.array(z.object({
    name: z.string(),
    in: z.enum(['query', 'path', 'header', 'cookie']),
    required: z.boolean(),
    schema: z.any(),
    description: z.string().optional(),
  })).optional(),
  requestBody: z.object({
    contentType: z.string(),
    schema: z.any(),
    required: z.boolean(),
  }).optional(),
  responses: z.record(z.object({
    description: z.string(),
    contentType: z.string(),
    schema: z.any(),
  })).optional(),
  tags: z.array(z.string()).optional(),
  deprecated: z.boolean().optional(),
});

export const ParsedSchemaSchema = z.object({
  name: z.string(),
  type: z.string(),
  properties: z.record(z.any()).optional(),
  required: z.array(z.string()).optional(),
  enum: z.array(z.string()).optional(),
  items: z.any().optional(),
});

export const ParsedAPISpecSchema = z.object({
  provider: APIProviderSchema,
  title: z.string().optional(),
  version: z.string().optional(),
  baseUrl: z.string().optional(),
  endpoints: z.array(ParsedEndpointSchema),
  schemas: z.array(ParsedSchemaSchema),
  security: z.array(z.record(z.array(z.string()))).optional(),
});

export const GeneratedHookSchema = z.object({
  name: z.string(),
  endpoint: ParsedEndpointSchema,
  hookCode: z.string(),
  types: z.array(z.object({
    name: z.string(),
    content: z.string(),
  })),
  dependencies: z.array(z.string()).default(['@tanstack/react-query']),
});

export const GeneratedComponentSchema = z.object({
  name: z.string(),
  description: z.string(),
  props: z.array(z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean(),
    default: z.string().optional(),
  })),
  code: z.string(),
  imports: z.array(z.string()).default([]),
});

export type APIProvider = z.infer<typeof APIProviderSchema>;
export type APISpec = z.infer<typeof APISpecSchema>;
export type ParsedEndpoint = z.infer<typeof ParsedEndpointSchema>;
export type ParsedSchema = z.infer<typeof ParsedSchemaSchema>;
export type ParsedAPISpec = z.infer<typeof ParsedAPISpecSchema>;
export type GeneratedHook = z.infer<typeof GeneratedHookSchema>;
export type GeneratedComponent = z.infer<typeof GeneratedComponentSchema>;

// ============================================================================
// API Integration Engine
// ============================================================================

export class APIIntegrationEngine {
  private static storage = new Map<string, APISpec>();

  // ==========================================================================
  // Spec Management
  // ==========================================================================

  static async saveSpec(spec: APISpec): Promise<APISpec> {
    const id = spec.name; // Use name as key for now
    const existing = this.storage.get(id);

    const saved: APISpec = {
      ...spec,
      createdAt: existing?.createdAt || new Date(),
      updatedAt: new Date(),
    };

    this.storage.set(id, saved);
    return saved;
  }

  static async getSpec(name: string): Promise<APISpec | null> {
    return this.storage.get(name) || null;
  }

  static async getSpecsByProject(projectId: string): Promise<APISpec[]> {
    return Array.from(this.storage.values()).filter(s => s.projectId === projectId);
  }

  static async deleteSpec(name: string): Promise<boolean> {
    return this.storage.delete(name);
  }

  // ==========================================================================
  // Schema Parsing
  // ==========================================================================

  static async parseSpec(spec: APISpec): Promise<ParsedAPISpec> {
    switch (spec.provider) {
      case 'rest':
        return this.parseOpenAPI(spec);
      case 'graphql':
        return this.parseGraphQL(spec);
      case 'trpc':
        return this.parseTRPC(spec);
      default:
        throw new Error(`Unsupported provider: ${spec.provider}`);
    }
  }

  private static parseOpenAPI(spec: APISpec): ParsedAPISpec {
    let parsed: any;

    try {
      // Try parsing as JSON first
      parsed = JSON.parse(spec.spec);
    } catch {
      // Try YAML (simplified - in production use js-yaml)
      throw new Error('YAML parsing not implemented. Please provide JSON.');
    }

    // Validate OpenAPI structure
    if (!parsed.openapi && !parsed.swagger) {
      throw new Error('Invalid OpenAPI/Swagger specification');
    }

    const baseUrl = parsed.servers?.[0]?.url || spec.baseUrl || '';
    const endpoints: ParsedEndpoint[] = [];
    const schemas: ParsedSchema[] = [];

    // Extract paths
    for (const [path, pathItem] of Object.entries(parsed.paths || {})) {
      const pathItemObj = pathItem as any;

      for (const [method, operation] of Object.entries(pathItemObj)) {
        if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) {
          continue;
        }

        const op = operation as any;

        endpoints.push({
          path,
          method: method.toUpperCase() as ParsedEndpoint['method'],
          operationId: op.operationId,
          summary: op.summary,
          description: op.description,
          parameters: op.parameters?.map((p: any) => ({
            name: p.name,
            in: p.in,
            required: p.required || false,
            schema: p.schema,
            description: p.description,
          })),
          requestBody: op.requestBody ? {
            contentType: Object.keys(op.requestBody.content || {})[0] || 'application/json',
            schema: Object.values(op.requestBody.content || {})[0]?.schema,
            required: op.requestBody.required || false,
          } : undefined,
          responses: Object.fromEntries(
            Object.entries(op.responses || {}).map(([code, resp]: [string, any]) => [
              code,
              {
                description: resp.description,
                contentType: Object.keys(resp.content || {})[0] || 'application/json',
                schema: Object.values(resp.content || {})[0]?.schema,
              }
            ])
          ),
          tags: op.tags,
          deprecated: op.deprecated,
        });
      }
    }

    // Extract schemas/components
    for (const [name, schema] of Object.entries(parsed.components?.schemas || {})) {
      schemas.push({
        name,
        type: (schema as any).type || 'object',
        properties: (schema as any).properties,
        required: (schema as any).required,
        enum: (schema as any).enum,
        items: (schema as any).items,
      });
    }

    return {
      provider: 'rest',
      title: parsed.info?.title,
      version: parsed.info?.version,
      baseUrl,
      endpoints,
      schemas,
      security: parsed.security,
    };
  }

  private static parseGraphQL(spec: APISpec): ParsedAPISpec {
    // Simplified GraphQL SDL parsing
    // In production, use graphql-js to parse SDL and introspection
    const sdl = spec.spec;

    // Extract types from SDL (basic regex-based extraction)
    const typeRegex = /type\s+(\w+)\s*{([^}]+)}/g;
    const schemas: ParsedSchema[] = [];

    let match;
    while ((match = typeRegex.exec(sdl)) !== null) {
      const typeName = match[1];
      const fields = match[2];

      const fieldRegex = /(\w+)\s*:\s*([^!\n]+)/g;
      const properties: Record<string, any> = {};
      const required: string[] = [];

      let fieldMatch;
      while ((fieldMatch = fieldRegex.exec(fields)) !== null) {
        const fieldName = fieldMatch[1];
        const fieldType = fieldMatch[2].trim();
        const isRequired = fieldType.endsWith('!');
        const cleanType = fieldType.replace('!', '').trim();

        properties[fieldName] = { type: cleanType };
        if (isRequired) required.push(fieldName);
      }

      schemas.push({
        name: typeName,
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
      });
    }

    // GraphQL has a single endpoint
    const endpoints: ParsedEndpoint[] = [{
      path: '/graphql',
      method: 'POST',
      operationId: 'graphql',
      summary: 'GraphQL endpoint',
      description: 'Execute GraphQL queries and mutations',
      requestBody: {
        contentType: 'application/json',
        schema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            variables: { type: 'object' },
            operationName: { type: 'string' },
          },
          required: ['query'],
        },
        required: true,
      },
      responses: {
        '200': {
          description: 'GraphQL response',
          contentType: 'application/json',
          schema: { type: 'object' },
        },
      },
    }];

    return {
      provider: 'graphql',
      baseUrl: spec.baseUrl,
      endpoints,
      schemas,
    };
  }

  private static parseTRPC(spec: APISpec): ParsedAPISpec {
    // tRPC router definition parsing
    // In production, use @trpc/server to extract router types
    const routerDef = spec.spec;

    // For now, return a basic structure
    // Real implementation would parse the router definition
    return {
      provider: 'trpc',
      baseUrl: spec.baseUrl,
      endpoints: [{
        path: '/api/trpc',
        method: 'POST',
        operationId: 'trpc',
        summary: 'tRPC endpoint',
        description: 'tRPC procedure calls',
      }],
      schemas: [],
    };
  }

  // ==========================================================================
  // Code Generation
  // ==========================================================================

  static generateHooks(parsed: ParsedAPISpec): GeneratedHook[] {
    const hooks: GeneratedHook[] = [];

    for (const endpoint of parsed.endpoints) {
      const hookName = this.generateHookName(endpoint);
      const types = this.generateTypesForEndpoint(endpoint, parsed.schemas);
      const hookCode = this.generateHookCode(endpoint, hookName, parsed);

      hooks.push({
        name: hookName,
        endpoint,
        hookCode,
        types,
        dependencies: this.getDependencies(parsed.provider),
      });
    }

    return hooks;
  }

  static generateComponents(parsed: ParsedAPISpec): GeneratedComponent[] {
    const components: GeneratedComponent[] = [];

    // Group endpoints by tag/resource
    const byTag = new Map<string, ParsedEndpoint[]>();
    for (const endpoint of parsed.endpoints) {
      const tag = endpoint.tags?.[0] || 'default';
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push(endpoint);
    }

    for (const [tag, endpoints] of byTag) {
      // Generate list component
      const listEndpoints = endpoints.filter(e => e.method === 'GET' && !e.path.includes('{'));
      if (listEndpoints.length > 0) {
        components.push(this.generateListComponent(tag, listEndpoints[0], parsed));
      }

      // Generate create form component
      const createEndpoints = endpoints.filter(e => e.method === 'POST');
      if (createEndpoints.length > 0) {
        components.push(this.generateCreateFormComponent(tag, createEndpoints[0], parsed));
      }

      // Generate detail/edit component
      const detailEndpoints = endpoints.filter(e => e.method === 'GET' && e.path.includes('{'));
      if (detailEndpoints.length > 0) {
        components.push(this.generateDetailComponent(tag, detailEndpoints[0], parsed));
      }
    }

    return components;
  }

  private static generateHookName(endpoint: ParsedEndpoint): string {
    const base = endpoint.operationId || `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/[^a-zA-Z0-9]/g, '_')}`;
    return `use${base.charAt(0).toUpperCase() + base.slice(1)}`;
  }

  private static generateTypesForEndpoint(
    endpoint: ParsedEndpoint,
    schemas: ParsedSchema[]
  ): Array<{ name: string; content: string }> {
    const types: Array<{ name: string; content: string }> = [];

    // Request type
    if (endpoint.requestBody?.schema) {
      const requestType = this.schemaToType(endpoint.requestBody.schema, schemas, `${this.generateHookName(endpoint)}Request`);
      types.push(requestType);
    }

    // Response type
    const successResponse = endpoint.responses?.['200'] || endpoint.responses?.['201'] || Object.values(endpoint.responses || {})[0];
    if (successResponse?.schema) {
      const responseType = this.schemaToType(successResponse.schema, schemas, `${this.generateHookName(endpoint)}Response`);
      types.push(responseType);
    }

    // Query params type
    if (endpoint.parameters?.some(p => p.in === 'query')) {
      const queryProps: Record<string, any> = {};
      for (const param of endpoint.parameters.filter(p => p.in === 'query')) {
        queryProps[param.name] = { type: param.schema?.type || 'string', required: param.required };
      }
      types.push({
        name: `${this.generateHookName(endpoint)}Query`,
        content: this.objectToInterface(`${this.generateHookName(endpoint)}Query`, queryProps),
      });
    }

    // Path params type
    if (endpoint.parameters?.some(p => p.in === 'path')) {
      const pathProps: Record<string, any> = {};
      for (const param of endpoint.parameters.filter(p => p.in === 'path')) {
        pathProps[param.name] = { type: param.schema?.type || 'string', required: param.required };
      }
      types.push({
        name: `${this.generateHookName(endpoint)}Params`,
        content: this.objectToInterface(`${this.generateHookName(endpoint)}Params`, pathProps),
      });
    }

    return types;
  }

  private static schemaToType(
    schema: any,
    schemas: ParsedSchema[],
    name: string
  ): { name: string; content: string } {
    if (schema.$ref) {
      const refName = schema.$ref.split('/').pop() || 'Unknown';
      return { name, content: `export type ${name} = ${refName};\n\n// Import ${refName} from generated types` };
    }

    if (schema.type === 'object' && schema.properties) {
      return {
        name,
        content: this.objectToInterface(name, schema.properties, schema.required),
      };
    }

    if (schema.type === 'array' && schema.items) {
      const itemType = this.schemaToType(schema.items, schemas, `${name}Item`);
      return { name, content: `export type ${name} = ${itemType.name}[];` };
    }

    return { name, content: `export type ${name} = ${this.primitiveToTS(schema)};` };
  }

  private static objectToInterface(
    name: string,
    properties: Record<string, any>,
    required: string[] = []
  ): string {
    const props = Object.entries(properties).map(([key, value]) => {
      const isRequired = required.includes(key);
      const type = value.type || value.$ref?.split('/').pop() || 'any';
      const tsType = this.primitiveToTS({ type });
      return `  ${key}${isRequired ? '' : '?'}: ${tsType};`;
    }).join('\n');

    return `export interface ${name} {\n${props}\n}`;
  }

  private static primitiveToTS(schema: any): string {
    switch (schema.type) {
      case 'string':
        if (schema.format === 'date-time') return 'string'; // ISO date string
        if (schema.format === 'uuid') return 'string';
        if (schema.enum) return schema.enum.map((v: string) => `"${v}"`).join(' | ');
        return 'string';
      case 'integer':
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'array':
        return `${this.primitiveToTS(schema.items)}[]`;
      case 'object':
        return 'Record<string, any>';
      default:
        return 'any';
    }
  }

  private static generateHookCode(
    endpoint: ParsedEndpoint,
    hookName: string,
    parsed: ParsedAPISpec
  ): string {
    const baseUrl = parsed.baseUrl || '';
    const fullPath = `${baseUrl}${endpoint.path}`;
    const hasParams = endpoint.parameters?.some(p => p.in === 'path') || false;
    const hasQuery = endpoint.parameters?.some(p => p.in === 'query') || false;
    const hasBody = !!endpoint.requestBody;

    const queryKey = `[${JSON.stringify(fullPath)}]`;

    let pathParams = '';
    if (hasParams) {
      const params = endpoint.parameters!.filter(p => p.in === 'path').map(p => p.name).join(', ');
      pathParams = `, { params }: { params: ${hookName}Params }`;
    }

    let queryParams = '';
    if (hasQuery) {
      queryParams = `, query?: ${hookName}Query`;
    }

    let bodyParams = '';
    if (hasBody) {
      bodyParams = `, body: ${hookName}Request`;
    }

    const method = endpoint.method;
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    if (isMutation) {
      return `export function ${hookName}() {
  return useMutation<${hookName}Response, Error${bodyParams ? `, {${pathParams}${queryParams}${bodyParams}}` : ''}>({
    mutationFn: async (${pathParams ? '{ params }' : ''}${hasQuery ? ', { query }' : ''}${hasBody ? ', { body }' : ''}) => {
      const url = new URL(\`${fullPath}\${params ? '/' + Object.values(params).join('/') : ''}\`);
      ${hasQuery ? 'Object.entries(query || {}).forEach(([k, v]) => url.searchParams.append(k, String(v)));' : ''}

      const response = await fetch(url.toString(), {
        method: '${method}',
        headers: {
          'Content-Type': 'application/json',
          ${parsed.security ? '...getAuthHeaders()' : ''}
        },
        ${hasBody ? 'body: JSON.stringify(body),' : ''}
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
  });
}`;
    }

    return `export function ${hookName}(${hasParams ? '{ params }' : ''}${hasQuery ? ', { query }' : ''}) {
  return useQuery<${hookName}Response>({
    queryKey: ${queryKey}${hasParams ? `.concat(Object.values(params))` : ''}${hasQuery ? '.concat([query])' : ''},
    queryFn: async () => {
      const url = new URL(\`${fullPath}\${params ? '/' + Object.values(params).join('/') : ''}\`);
      ${hasQuery ? 'Object.entries(query || {}).forEach(([k, v]) => url.searchParams.append(k, String(v)));' : ''}

      const response = await fetch(url.toString(), {
        method: '${method}',
        headers: {
          'Content-Type': 'application/json',
          ${parsed.security ? '...getAuthHeaders()' : ''}
        },
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
  });
}`;
  }

  private static generateListComponent(
    tag: string,
    endpoint: ParsedEndpoint,
    parsed: ParsedAPISpec
  ): GeneratedComponent {
    const componentName = `${tag.charAt(0).toUpperCase() + tag.slice(1)}List`;
    const hookName = this.generateHookName(endpoint);

    return {
      name: componentName,
      description: `List view for ${tag}`,
      props: [],
      imports: [
        'import { useQuery } from "@tanstack/react-query";',
        `import { ${hookName} } from "./hooks";`,
      ],
      code: `export function ${componentName}() {
  const { data, isLoading, error } = ${hookName}();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div className="text-red-500">Error: {error.message}</div>;

  return (
    <div className="space-y-4">
      {data?.map((item: any) => (
        <div key={item.id} className="p-4 border rounded">
          <pre className="text-sm">{JSON.stringify(item, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}`,
    };
  }

  private static generateCreateFormComponent(
    tag: string,
    endpoint: ParsedEndpoint,
    parsed: ParsedAPISpec
  ): GeneratedComponent {
    const componentName = `Create${tag.charAt(0).toUpperCase() + tag.slice(1)}`;
    const hookName = this.generateHookName(endpoint);

    return {
      name: componentName,
      description: `Create form for ${tag}`,
      props: [
        { name: 'onSuccess', type: '() => void', required: false },
      ],
      imports: [
        'import { useMutation } from "@tanstack/react-query";',
        'import { useState } from "react";',
        `import { ${hookName} } from "./hooks";`,
      ],
      code: `export function ${componentName}({ onSuccess }: { onSuccess?: () => void }) {
  const [form, setForm] = useState<${hookName}Request>({} as any);
  const mutation = ${hookName}();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await mutation.mutateAsync({ body: form });
    onSuccess?.();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Form fields based on ${hookName}Request type */}
      <button type="submit" disabled={mutation.isPending} className="bg-primary text-primary-foreground px-4 py-2 rounded">
        {mutation.isPending ? 'Creating...' : 'Create'}
      </button>
    </form>
  );
}`,
    };
  }

  private static generateDetailComponent(
    tag: string,
    endpoint: ParsedEndpoint,
    parsed: ParsedAPISpec
  ): GeneratedComponent {
    const componentName = `${tag.charAt(0).toUpperCase() + tag.slice(1)}Detail`;
    const hookName = this.generateHookName(endpoint);

    return {
      name: componentName,
      description: `Detail view for ${tag}`,
      props: [
        { name: 'id', type: 'string', required: true },
      ],
      imports: [
        'import { useQuery } from "@tanstack/react-query";',
        `import { ${hookName} } from "./hooks";`,
      ],
      code: `export function ${componentName}({ id }: { id: string }) {
  const { data, isLoading, error } = ${hookName}({ params: { id } });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div className="text-red-500">Error: {error.message}</div>;
  if (!data) return <div>Not found</div>;

  return (
    <div className="p-4 border rounded">
      <pre className="text-sm">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}`,
    };
  }

  private static getDependencies(provider: APIProvider): string[] {
    const base = ['@tanstack/react-query'];
    switch (provider) {
      case 'graphql':
        return [...base, 'urql', 'graphql'];
      case 'trpc':
        return [...base, '@trpc/react-query', '@trpc/client'];
      default:
        return base;
    }
  }

  // ==========================================================================
  // Validation
  // ==========================================================================

  static validateSpec(config: unknown): { valid: boolean; errors: string[] } {
    const result = APISpecSchema.safeParse(config);
    return {
      valid: result.success,
      errors: result.success ? [] : result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
    };
  }
}