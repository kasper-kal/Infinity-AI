/**
 * API Integration Wizard
 *
 * Parses OpenAPI/Swagger, GraphQL, and tRPC schemas to generate:
 * - TypeScript types
 * - TanStack Query hooks (REST)
 * - urql/Apollo hooks (GraphQL)
 * - tRPC router inference types
 */

import { z } from 'zod';

// ============================================================================
// Schema Definitions
// ============================================================================

export const OpenAPISchema = z.object({
  openapi: z.string(),
  info: z.object({
    title: z.string(),
    version: z.string(),
    description: z.string().optional(),
  }),
  servers: z.array(z.object({
    url: z.string(),
    description: z.string().optional(),
  })).optional(),
  paths: z.record(z.string(), z.record(z.string(), z.any())),
  components: z.object({
    schemas: z.record(z.string(), z.any()).optional(),
    securitySchemes: z.record(z.string(), z.any()).optional(),
  }).optional(),
  security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
});

export const GraphQLSchema = z.object({
  schema: z.string(), // SDL or introspection JSON
  introspection: z.any().optional(), // Full introspection result
});

export const TRPCSchema = z.object({
  router: z.any(), // tRPC router instance or serialized definition
  procedures: z.array(z.object({
    path: z.string(),
    type: z.enum(['query', 'mutation', 'subscription']),
    input: z.any().optional(),
    output: z.any().optional(),
  })).optional(),
});

export const APIIntegrationConfigSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  type: z.enum(['rest', 'graphql', 'trpc']),
  spec: z.union([OpenAPISchema, GraphQLSchema, TRPCSchema]),
  baseUrl: z.string().optional(), // For REST
  headers: z.record(z.string()).optional(),
  auth: z.object({
    type: z.enum(['bearer', 'apiKey', 'basic', 'none']),
    token: z.string().optional(),
    headerName: z.string().optional(),
  }).optional(),
  options: z.object({
    generateTypes: z.boolean().default(true),
    generateHooks: z.boolean().default(true),
    generateComponents: z.boolean().default(false),
    client: z.enum(['tanstack', 'axios', 'fetch', 'urql', 'apollo', 'trpc']).default('tanstack'),
    outputDir: z.string().optional(),
  }).optional(),
});

export type OpenAPISpec = z.infer<typeof OpenAPISchema>;
export type GraphQLSpec = z.infer<typeof GraphQLSchema>;
export type TRPCSpec = z.infer<typeof TRPCSchema>;
export type APIIntegrationConfig = z.infer<typeof APIIntegrationConfigSchema>;

// ============================================================================
// Type Generation
// ============================================================================

export interface GeneratedType {
  name: string;
  content: string;
  kind: 'interface' | 'type' | 'enum' | 'schema';
  dependencies: string[];
}

export interface GeneratedHook {
  name: string;
  content: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'query' | 'mutation';
  path: string;
  requestType?: string;
  responseType?: string;
}

export interface GeneratedComponent {
  name: string;
  content: string;
  props: string;
  hooksUsed: string[];
}

export interface APIIntegrationResult {
  types: GeneratedType[];
  hooks: GeneratedHook[];
  components: GeneratedComponent[];
  errors: string[];
  warnings: string[];
}

// ============================================================================
// OpenAPI Parser
// ============================================================================

export class OpenAPIParser {
  private spec: OpenAPISpec;

  constructor(spec: OpenAPISpec) {
    this.spec = spec;
  }

  parse(): APIIntegrationResult {
    const result: APIIntegrationResult = {
      types: [],
      hooks: [],
      components: [],
      errors: [],
      warnings: [],
    };

    try {
      // Parse schemas from components
      if (this.spec.components?.schemas) {
        for (const [name, schema] of Object.entries(this.spec.components.schemas)) {
          const type = this.parseSchema(name, schema);
          if (type) result.types.push(type);
        }
      }

      // Parse paths and generate hooks
      for (const [path, methods] of Object.entries(this.spec.paths)) {
        for (const [method, operation] of Object.entries(methods)) {
          if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;

          const hook = this.generateHook(path, method.toUpperCase() as any, operation);
          if (hook) result.hooks.push(hook);
        }
      }
    } catch (error) {
      result.errors.push(`OpenAPI parsing error: ${error}`);
    }

    return result;
  }

  private parseSchema(name: string, schema: any): GeneratedType | null {
    // Convert OpenAPI schema to TypeScript interface/type
    const tsType = this.openAPISchemaToTS(name, schema);
    if (!tsType) return null;

    return {
      name,
      content: tsType,
      kind: 'interface',
      dependencies: this.extractDependencies(schema),
    };
  }

  private openAPISchemaToTS(name: string, schema: any): string | null {
    if (schema.type === 'object' && schema.properties) {
      const props = Object.entries(schema.properties).map(([propName, propSchema]: [string, any]) => {
        const required = schema.required?.includes(propName) ? '' : '?';
        const type = this.openAPISchemaToTSType(propSchema);
        return `  ${propName}${required}: ${type};`;
      }).join('\n');

      return `export interface ${name} {\n${props}\n}`;
    }

    if (schema.type === 'array' && schema.items) {
      const itemType = this.openAPISchemaToTSType(schema.items);
      return `export type ${name} = ${itemType}[];`;
    }

    if (schema.enum) {
      const values = schema.enum.map((v: any) => typeof v === 'string' ? `"${v}"` : v).join(' | ');
      return `export type ${name} = ${values};`;
    }

    if (schema.allOf) {
      const interfaces = schema.allOf.map((s: any, i: number) => this.openAPISchemaToTS(`${name}_${i}`, s)).filter(Boolean);
      return interfaces.length > 0 ? `export type ${name} = ${interfaces.join(' & ')};` : null;
    }

    if (schema.oneOf || schema.anyOf) {
      const types = (schema.oneOf || schema.anyOf).map((s: any, i: number) => this.openAPISchemaToTS(`${name}_${i}`, s)).filter(Boolean);
      return types.length > 0 ? `export type ${name} = ${types.join(' | ')};` : null;
    }

    return null;
  }

  private openAPISchemaToTSType(schema: any): string {
    if (schema.$ref) {
      return schema.$ref.split('/').pop() || 'any';
    }

    switch (schema.type) {
      case 'string':
        if (schema.format === 'date-time') return 'string'; // ISO date string
        if (schema.format === 'uuid') return 'string';
        if (schema.format === 'email') return 'string';
        return 'string';
      case 'integer':
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'array':
        return `${this.openAPISchemaToTSType(schema.items)}[]`;
      case 'object':
        if (schema.properties) {
          return this.openAPISchemaToTS('Anonymous', schema)?.replace('export interface Anonymous {', '{').replace('}', '}') || 'Record<string, any>';
        }
        return 'Record<string, any>';
      default:
        return 'any';
    }
  }

  private extractDependencies(schema: any): string[] {
    const deps: string[] = [];
    const visit = (s: any) => {
      if (s.$ref) {
        deps.push(s.$ref.split('/').pop() || '');
      }
      if (s.items) visit(s.items);
      if (s.properties) Object.values(s.properties).forEach(visit);
      if (s.allOf) s.allOf.forEach(visit);
      if (s.oneOf) s.oneOf.forEach(visit);
      if (s.anyOf) s.anyOf.forEach(visit);
    };
    visit(schema);
    return [...new Set(deps)].filter(Boolean);
  }

  private generateHook(path: string, method: string, operation: any): GeneratedHook | null {
    const operationId = operation.operationId || `${method.toLowerCase()}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const hookName = `use${operationId.charAt(0).toUpperCase() + operationId.slice(1)}`;

    // Extract request/response types
    let requestType: string | undefined;
    let responseType: string | undefined;

    if (operation.requestBody?.content?.['application/json']?.schema) {
      requestType = this.openAPISchemaToTSType(operation.requestBody.content['application/json'].schema);
      if (requestType.startsWith('export ')) {
        requestType = requestType.replace('export type ', '').replace('export interface ', '').split(' ')[0];
      }
    }

    const successResponse = operation.responses?.['200'] || operation.responses?.['201'] || Object.values(operation.responses)[0];
    if (successResponse?.content?.['application/json']?.schema) {
      responseType = this.openAPISchemaToTSType(successResponse.content['application/json'].schema);
      if (responseType.startsWith('export ')) {
        responseType = responseType.replace('export type ', '').replace('export interface ', '').split(' ')[0];
      }
    }

    // Generate TanStack Query hook
    const hookContent = this.generateTanStackQueryHook(hookName, method, path, requestType, responseType, operation);

    return {
      name: hookName,
      content: hookContent,
      method: method as any,
      path,
      requestType,
      responseType,
    };
  }

  private generateTanStackQueryHook(
    name: string,
    method: string,
    path: string,
    requestType?: string,
    responseType?: string,
    operation?: any
  ): string {
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const pathParams = path.match(/{([^}]+)}/g)?.map(p => p.slice(1, -1)) || [];
    const queryParams = operation?.parameters?.filter((p: any) => p.in === 'query') || [];

    const paramsType = [...pathParams, ...queryParams.map((p: any) => p.name)].length > 0
      ? `{ ${[...pathParams, ...queryParams.map((p: any) => p.name)].map(p => `${p}: string`).join(', ')} }`
      : 'void';

    if (isMutation) {
      return `export function ${name}() {
  return useMutation<${responseType || 'any'}, Error, ${requestType || 'void'}>({
    mutationFn: async (data${requestType ? `: ${requestType}` : ''}) => {
      const response = await fetch(\`\${baseUrl}${path.replace(/{([^}]+)}/g, (_, p) => \`\${data[p]}\`)}\`, {
        method: '${method}',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
  });
}`;
    }

    return `export function ${name}(params${paramsType !== 'void' ? `: ${paramsType}` : ''}) {
  return useQuery<${responseType || 'any'}, Error>({
    queryKey: ['${path}', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      ${queryParams.map((p: any) => `if (params.${p.name}) searchParams.append('${p.name}', params.${p.name});`).join('\n      ')}
      const url = \`\${baseUrl}${path.replace(/{([^}]+)}/g, (_, p) => \`\${params[p]}\`)}\${searchParams.toString() ? '?' + searchParams.toString() : ''}\`;
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    enabled: ${pathParams.map(p => `!!params.${p}`).join(' && ') || 'true'},
  });
}`;
  }
}

// ============================================================================
// GraphQL Parser
// ============================================================================

export class GraphQLParser {
  private schema: GraphQLSpec;

  constructor(schema: GraphQLSpec) {
    this.schema = schema;
  }

  parse(): APIIntegrationResult {
    const result: APIIntegrationResult = {
      types: [],
      hooks: [],
      components: [],
      errors: [],
      warnings: [],
    };

    try {
      // If introspection is provided, use it
      if (this.schema.introspection) {
        return this.parseIntrospection(this.schema.introspection);
      }

      // Otherwise parse SDL
      if (this.schema.schema) {
        return this.parseSDL(this.schema.schema);
      }

      result.errors.push('No GraphQL schema or introspection provided');
    } catch (error) {
      result.errors.push(`GraphQL parsing error: ${error}`);
    }

    return result;
  }

  private parseIntrospection(introspection: any): APIIntegrationResult {
    const result: APIIntegrationResult = {
      types: [],
      hooks: [],
      components: [],
      errors: [],
      warnings: [],
    };

    // Parse types from introspection
    if (introspection.__schema?.types) {
      for (const type of introspection.__schema.types) {
        if (type.name.startsWith('__')) continue; // Skip introspection types

        const tsType = this.introspectionTypeToTS(type);
        if (tsType) {
          result.types.push({
            name: type.name,
            content: tsType,
            kind: type.kind === 'ENUM' ? 'enum' : type.kind === 'SCALAR' ? 'type' : 'interface',
            dependencies: this.extractTypeDependencies(type),
          });
        }
      }
    }

    // Generate hooks for queries/mutations
    const queryType = introspection.__schema?.queryType?.name;
    const mutationType = introspection.__schema?.mutationType?.name;

    if (queryType) {
      const queryFields = introspection.__schema?.types?.find((t: any) => t.name === queryType)?.fields || [];
      for (const field of queryFields) {
        const hook = this.generateGraphQLHook(field, 'query');
        if (hook) result.hooks.push(hook);
      }
    }

    if (mutationType) {
      const mutationFields = introspection.__schema?.types?.find((t: any) => t.name === mutationType)?.fields || [];
      for (const field of mutationFields) {
        const hook = this.generateGraphQLHook(field, 'mutation');
        if (hook) result.hooks.push(hook);
      }
    }

    return result;
  }

  private parseSDL(sdl: string): APIIntegrationResult {
    // Basic SDL parsing - would need graphql-js for full parsing
    const result: APIIntegrationResult = {
      types: [],
      hooks: [],
      components: [],
      errors: [],
      warnings: ['SDL parsing is limited - prefer introspection'],
    };
    return result;
  }

  private introspectionTypeToTS(type: any): string | null {
    switch (type.kind) {
      case 'OBJECT':
      case 'INTERFACE': {
        const fields = type.fields?.map((f: any) => {
          const tsType = this.graphQLTypeToTS(f.type);
          return `  ${f.name}${f.args?.length ? `(${f.args.map((a: any) => `${a.name}: ${this.graphQLTypeToTS(a.type)}`).join(', ')})` : ''}: ${tsType};`;
        }).join('\n') || '';
        return `export interface ${type.name} {\n${fields}\n}`;
      }
      case 'ENUM': {
        const values = type.enumValues?.map((v: any) => `"${v.name}"`).join(' | ') || '';
        return `export type ${type.name} = ${values};`;
      }
      case 'SCALAR':
        return `export type ${type.name} = any; // Scalar`;
      case 'INPUT_OBJECT': {
        const fields = type.inputFields?.map((f: any) => {
          const tsType = this.graphQLTypeToTS(f.type);
          return `  ${f.name}: ${tsType};`;
        }).join('\n') || '';
        return `export interface ${type.name}Input {\n${fields}\n}`;
      }
      default:
        return null;
    }
  }

  private graphQLTypeToTS(type: any): string {
    if (type.kind === 'NON_NULL') {
      return this.graphQLTypeToTS(type.ofType);
    }
    if (type.kind === 'LIST') {
      return `${this.graphQLTypeToTS(type.ofType)}[]`;
    }
    return type.name || 'any';
  }

  private extractTypeDependencies(type: any): string[] {
    const deps: string[] = [];
    const visit = (t: any) => {
      if (t.kind === 'NON_NULL' || t.kind === 'LIST') {
        visit(t.ofType);
      } else if (t.name && !['String', 'Int', 'Float', 'Boolean', 'ID'].includes(t.name)) {
        deps.push(t.name);
      }
    };
    if (type.fields) type.fields.forEach((f: any) => visit(f.type));
    if (type.inputFields) type.inputFields.forEach((f: any) => visit(f.type));
    return [...new Set(deps)];
  }

  private generateGraphQLHook(field: any, operationType: 'query' | 'mutation'): GeneratedHook | null {
    const hookName = `use${field.name.charAt(0).toUpperCase() + field.name.slice(1)}${operationType.charAt(0).toUpperCase() + operationType.slice(1)}`;
    const args = field.args?.map((a: any) => `${a.name}: ${this.graphQLTypeToTS(a.type)}`).join(', ') || '';
    const returnType = this.graphQLTypeToTS(field.type);

    const hookContent = `export function ${hookName}(${args ? `variables: { ${args} }` : ''}) {
  return use${operationType.charAt(0).toUpperCase() + operationType.slice(1)}<${returnType}>({
    document: gql\`
      ${operationType} ${field.name}(${args ? `$${args.split(', ').join(', $')}` : ''}) {
        ${this.generateSelectionSet(field.type)}
      }
    \`,
    variables,
  });
}`;

    return {
      name: hookName,
      content: hookContent,
      method: operationType === 'query' ? 'query' : 'mutation',
      path: field.name,
      responseType: returnType,
    };
  }

  private generateSelectionSet(type: any, depth = 0): string {
    if (depth > 3) return '...'; // Prevent infinite recursion
    if (type.kind === 'NON_NULL' || type.kind === 'LIST') {
      return this.generateSelectionSet(type.ofType, depth);
    }
    // For object types, we'd need the full schema to generate proper selection
    return 'id'; // Simplified
  }
}

// ============================================================================
// tRPC Parser
// ============================================================================

export class TRPCParser {
  private schema: TRPCSpec;

  constructor(schema: TRPCSpec) {
    this.schema = schema;
  }

  parse(): APIIntegrationResult {
    const result: APIIntegrationResult = {
      types: [],
      hooks: [],
      components: [],
      errors: [],
      warnings: [],
    };

    try {
      if (this.schema.procedures) {
        for (const proc of this.schema.procedures) {
          const types = this.generateTRPCTypes(proc);
          result.types.push(...types);

          const hook = this.generateTRPCHook(proc);
          if (hook) result.hooks.push(hook);
        }
      }
    } catch (error) {
      result.errors.push(`tRPC parsing error: ${error}`);
    }

    return result;
  }

  private generateTRPCTypes(proc: any): GeneratedType[] {
    const types: GeneratedType[] = [];

    if (proc.input) {
      types.push({
        name: `${proc.path.replace(/\./g, '_')}_Input`,
        content: `export type ${proc.path.replace(/\./g, '_')}_Input = ${this.zodToTS(proc.input)};`,
        kind: 'type',
        dependencies: [],
      });
    }

    if (proc.output) {
      types.push({
        name: `${proc.path.replace(/\./g, '_')}_Output`,
        content: `export type ${proc.path.replace(/\./g, '_')}_Output = ${this.zodToTS(proc.output)};`,
        kind: 'type',
        dependencies: [],
      });
    }

    return types;
  }

  private zodToTS(zodSchema: any): string {
    // Simplified Zod to TS conversion
    if (zodSchema._def?.typeName === 'ZodObject') {
      const shape = zodSchema._def.shape();
      const props = Object.entries(shape).map(([k, v]: [string, any]) => {
        const optional = v._def?.typeName === 'ZodOptional' ? '?' : '';
        return `  ${k}${optional}: ${this.zodToTS(v._def?.innerType || v)};`;
      }).join('\n');
      return `{\n${props}\n}`;
    }
    if (zodSchema._def?.typeName === 'ZodArray') {
      return `${this.zodToTS(zodSchema._def.type)}[]`;
    }
    if (zodSchema._def?.typeName === 'ZodOptional') {
      return `${this.zodToTS(zodSchema._def.innerType)} | undefined`;
    }
    if (zodSchema._def?.typeName === 'ZodString') return 'string';
    if (zodSchema._def?.typeName === 'ZodNumber') return 'number';
    if (zodSchema._def?.typeName === 'ZodBoolean') return 'boolean';
    if (zodSchema._def?.typeName === 'ZodEnum') return zodSchema._def.values.map((v: any) => `"${v}"`).join(' | ');
    return 'any';
  }

  private generateTRPCHook(proc: any): GeneratedHook | null {
    const hookName = `use${proc.path.split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')}`;
    const isMutation = proc.type === 'mutation';

    const hookContent = `export function ${hookName}() {
  return trpc.${proc.path}.${isMutation ? 'useMutation' : 'useQuery'}();
}`;

    return {
      name: hookName,
      content: hookContent,
      method: proc.type === 'query' ? 'query' : 'mutation',
      path: proc.path,
    };
  }
}

// ============================================================================
// Main Integration Engine
// ============================================================================

export class APIIntegrationEngine {
  static async parse(config: APIIntegrationConfig): Promise<APIIntegrationResult> {
    let parser: OpenAPIParser | GraphQLParser | TRPCParser;

    switch (config.type) {
      case 'rest':
        parser = new OpenAPIParser(config.spec as OpenAPISpec);
        break;
      case 'graphql':
        parser = new GraphQLParser(config.spec as GraphQLSpec);
        break;
      case 'trpc':
        parser = new TRPCParser(config.spec as TRPCSpec);
        break;
      default:
        return { types: [], hooks: [], components: [], errors: ['Unknown API type'], warnings: [] };
    }

    return parser.parse();
  }

  static async generateFiles(result: APIIntegrationResult, outputDir: string): Promise<string[]> {
    // This would write files to disk - for now return file paths
    const files: string[] = [];

    for (const type of result.types) {
      files.push(`${outputDir}/types/${type.name}.ts`);
    }
    for (const hook of result.hooks) {
      files.push(`${outputDir}/hooks/${hook.name}.ts`);
    }
    for (const component of result.components) {
      files.push(`${outputDir}/components/${component.name}.tsx`);
    }

    return files;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

export function validateOpenAPISpec(spec: unknown): { valid: boolean; errors: string[] } {
  const result = OpenAPISchema.safeParse(spec);
  return {
    valid: result.success,
    errors: result.success ? [] : result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

export function validateGraphQLSpec(spec: unknown): { valid: boolean; errors: string[] } {
  const result = GraphQLSchema.safeParse(spec);
  return {
    valid: result.success,
    errors: result.success ? [] : result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

export function validateTRPCSpec(spec: unknown): { valid: boolean; errors: string[] } {
  const result = TRPCSchema.safeParse(spec);
  return {
    valid: result.success,
    errors: result.success ? [] : result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

export function fetchOpenAPISpec(url: string): Promise<OpenAPISpec> {
  return fetch(url).then(r => r.json());
}

export async function fetchGraphQLIntrospection(endpoint: string, headers?: Record<string, string>): Promise<any> {
  const introspectionQuery = `
    query IntrospectionQuery {
      __schema {
        queryType { name }
        mutationType { name }
        types {
          kind
          name
          fields { name args { name type { kind name ofType } } type { kind name ofType } }
          inputFields { name type { kind name ofType } }
          enumValues { name }
        }
      }
    }
  `;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ query: introspectionQuery }),
  });

  const result = await response.json();
  return result.data?.__schema ? { introspection: result.data } : { schema: result };
}