/**
 * API Wizard — Connect external APIs (OpenAPI/Swagger, GraphQL, tRPC) to generated UI
 * Generates typed hooks (TanStack Query, urql/Apollo, tRPC) + TypeScript types + components
 */

'use client';

import { useState, useCallback } from 'react';
import { Button, IconButton } from '@/components/ui';
import { Input, Textarea } from '@/components/ui';
import { Select } from '@/components/ui';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui';
import { Card, CardHeader, CardContent } from '@/components/ui';
import { Badge } from '@/components/ui';
import { Tooltip } from '@/components/ui';
import { CodeEditor } from '@/components/ui';
import { Checkbox } from '@/components/ui';
import { Label } from '@/components/ui';
import { Separator } from '@/components/ui';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui';
import {
  LucidePlay,
  LucideCopy,
  LucideDownload,
  LucideCheck,
  LucideX,
  LucideFileCode,
  LucideDatabase,
  LucideZap,
  LucideGithub,
  LucideGlobe,
  LucideCog,
  LucidePlus,
  LucideTrash2,
  LucideEye,
  LucideEyeOff,
} from 'lucide-react';

export interface APISchema {
  type: 'openapi' | 'graphql' | 'trpc';
  name: string;
  content: string;
  url?: string;
}

export interface GeneratedAPIClient {
  name: string;
  types: string;
  hooks: string;
  components: string;
  client: string;
  files: Array<{ path: string; content: string }>;
}

interface APIWizardProps {
  onGenerate?: (client: GeneratedAPIClient) => void;
  onClose?: () => void;
  projectId?: string;
}

const API_TYPES = [
  { value: 'openapi', label: 'OpenAPI / Swagger', icon: LucideGlobe, description: 'REST APIs with OpenAPI 3.x specification' },
  { value: 'graphql', label: 'GraphQL', icon: LucideDatabase, description: 'GraphQL schema via introspection or SDL' },
  { value: 'trpc', label: 'tRPC', icon: LucideZap, description: 'tRPC router inference for end-to-end types' },
] as const;

const HOOK_LIBRARIES = {
  openapi: [
    { value: 'tanstack-query', label: 'TanStack Query (React Query)', recommended: true },
    { value: 'swr', label: 'SWR' },
    { value: 'axios', label: 'Axios + Custom Hooks' },
  ],
  graphql: [
    { value: 'urql', label: 'urql', recommended: true },
    { value: 'apollo', label: 'Apollo Client' },
    { value: 'graphql-request', label: 'graphql-request' },
  ],
  trpc: [
    { value: 'trpc-react', label: '@trpc/react-query', recommended: true },
    { value: 'trpc-next', label: '@trpc/next (App Router)' },
  ],
} as const;

const SAMPLE_SCHEMAS = {
  openapi: `openapi: 3.0.0
info:
  title: Sample API
  version: 1.0.0
servers:
  - url: https://api.example.com/v1
paths:
  /users:
    get:
      summary: List users
      parameters:
        - name: page
          in: query
          schema:
            type: integer
            default: 1
        - name: limit
          in: query
          schema:
            type: integer
            default: 10
      responses:
        '200':
          description: List of users
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      \$ref: '#/components/schemas/User'
                  total:
                    type: integer
    post:
      summary: Create user
      requestBody:
        required: true
        content:
          application/json:
            schema:
              \$ref: '#/components/schemas/CreateUserInput'
      responses:
        '201':
          description: Created user
          content:
            application/json:
              schema:
                \$ref: '#/components/schemas/User'
  /users/{id}:
    get:
      summary: Get user by ID
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: User found
          content:
            application/json:
              schema:
                \$ref: '#/components/schemas/User'
        '404':
          description: User not found
    patch:
      summary: Update user
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              \$ref: '#/components/schemas/UpdateUserInput'
      responses:
        '200':
          description: Updated user
          content:
            application/json:
              schema:
                \$ref: '#/components/schemas/User'
    delete:
      summary: Delete user
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: User deleted
components:
  schemas:
    User:
      type: object
      properties:
        id:
          type: string
          format: uuid
        email:
          type: string
          format: email
        name:
          type: string
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
      required:
        - id
        - email
        - name
    CreateUserInput:
      type: object
      properties:
        email:
          type: string
          format: email
        name:
          type: string
      required:
        - email
        - name
    UpdateUserInput:
      type: object
      properties:
        email:
          type: string
          format: email
        name:
          type: string`,
  graphql: `type Query {
  users(page: Int = 1, limit: Int = 10): UserConnection!
  user(id: ID!): User
  me: User
}

type Mutation {
  createUser(input: CreateUserInput!): User!
  updateUser(id: ID!, input: UpdateUserInput!): User!
  deleteUser(id: ID!): Boolean!
}

type UserConnection {
  data: [User!]!
  total: Int!
  page: Int!
  hasNextPage: Boolean!
}

type User {
  id: ID!
  email: String!
  name: String!
  createdAt: DateTime!
  updatedAt: DateTime!
}

input CreateUserInput {
  email: String!
  name: String!
}

input UpdateUserInput {
  email: String
  name: String
}

scalar DateTime`,
  trpc: `import { z } from 'zod';
import { createTRPCRouter, publicProcedure, protectedProcedure } from '../trpc';

export const userRouter = createTRPCRouter({
  list: publicProcedure
    .input(z.object({
      page: z.number().default(1),
      limit: z.number().default(10),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.db.user.findMany({
        take: input.limit,
        skip: (input.page - 1) * input.limit,
      });
    }),

  byId: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.user.findUnique({ where: { id: input.id } });
    }),

  create: protectedProcedure
    .input(z.object({
      email: z.string().email(),
      name: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.user.create({ data: input });
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      email: z.string().email().optional(),
      name: z.string().min(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return ctx.db.user.update({ where: { id }, data });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.user.delete({ where: { id: input.id } });
    }),
});`,
} as const;

export function APIWizard({ onGenerate, onClose, projectId }: APIWizardProps) {
  const [activeTab, setActiveTab] = useState<'input' | 'preview' | 'files'>('input');
  const [apiType, setApiType] = useState<'openapi' | 'graphql' | 'trpc'>('openapi');
  const [schemaInput, setSchemaInput] = useState(SAMPLE_SCHEMAS.openapi);
  const [schemaUrl, setSchemaUrl] = useState('');
  const [hookLibrary, setHookLibrary] = useState('tanstack-query');
  const [clientName, setClientName] = useState('api');
  const [baseUrl, setBaseUrl] = useState('https://api.example.com');
  const [includeComponents, setIncludeComponents] = useState(true);
  const [includeAuth, setIncludeAuth] = useState(false);
  const [authType, setAuthType] = useState<'bearer' | 'api-key' | 'cookie'>('bearer');
  const [generatedClient, setGeneratedClient] = useState<GeneratedAPIClient | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState(0);

  const handleSchemaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setSchemaInput(e.target.value);
    setError(null);
  }, []);

  const handleUrlLoad = useCallback(async () => {
    if (!schemaUrl.trim()) return;
    setError(null);
    try {
      const response = await fetch(`/api/infinity/api-integration/fetch-schema`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: schemaUrl, type: apiType }),
      });
      if (!response.ok) throw new Error('Failed to fetch schema');
      const data = await response.json();
      setSchemaInput(data.schema);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schema from URL');
    }
  }, [schemaUrl, apiType]);

  const handleGenerate = useCallback(async () => {
    if (!schemaInput.trim()) {
      setError('Please provide a schema');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch(`/api/infinity/api-integration/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          type: apiType,
          schema: schemaInput,
          name: clientName,
          baseUrl,
          hookLibrary,
          includeComponents,
          auth: includeAuth ? { type: authType } : undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Generation failed');
      }

      const client = await response.json();
      setGeneratedClient(client);
      setActiveTab('preview');
      onGenerate?.(client);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  }, [
    schemaInput, apiType, projectId, clientName, baseUrl,
    hookLibrary, includeComponents, includeAuth, authType, onGenerate
  ]);

  const currentHookLibraries = HOOK_LIBRARIES[apiType];
  const recommendedLib = currentHookLibraries.find(l => l.recommended)?.value || currentHookLibraries[0].value;

  // Auto-switch hook library when API type changes
  if (!currentHookLibraries.some(l => l.value === hookLibrary)) {
    setHookLibrary(recommendedLib);
  }

  return (
    <div className="api-wizard" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 600 }}>
      {/* Header */}
      <div className="api-wizard-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LucideZap style={{ width: 24, height: 24, color: 'var(--primary)' }} />
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>API Integration Wizard</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tooltip content="Close">
            <IconButton onClick={onClose} variant="ghost" size="sm" aria-label="Close">
              <LucideX style={{ width: 16, height: 16 }} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive" style={{ margin: '16px 20px', padding: '12px 16px' }}>
          <AlertTitle>Generation Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="api-wizard-tabs" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <TabsList style={{ borderBottom: '1px solid var(--border)', padding: '0 20px' }}>
          <TabsTrigger value="input" style={{ minWidth: 100 }}>
            <LucideFileCode style={{ width: 14, height: 14, marginRight: 6 }} />
            Schema Input
          </TabsTrigger>
          <TabsTrigger value="preview" disabled={!generatedClient} style={{ minWidth: 100 }}>
            <LucideEye style={{ width: 14, height: 14, marginRight: 6 }} />
            Preview
          </TabsTrigger>
          <TabsTrigger value="files" disabled={!generatedClient} style={{ minWidth: 100 }}>
            <LucideDatabase style={{ width: 14, height: 14, marginRight: 6 }} />
            Files
          </TabsTrigger>
        </TabsList>

        {/* Tab: Schema Input */}
        <TabsContent value="input" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', padding: '20px', gap: 20, overflow: 'hidden' }}>
            {/* Left Panel: Schema Input */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>API Schema</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Select
                    value={apiType}
                    onValueChange={setApiType}
                    options={API_TYPES.map(t => ({ value: t.value, label: t.label }))}
                    style={{ minWidth: 160 }}
                  />
                </div>
              </div>

              {/* URL Input */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <Input
                  placeholder="Or paste schema URL (OpenAPI JSON/YAML, GraphQL endpoint, tRPC router export)"
                  value={schemaUrl}
                  onChange={e => setSchemaUrl(e.target.value)}
                  style={{ flex: 1 }}
                />
                <Button onClick={handleUrlLoad} disabled={!schemaUrl.trim() || isGenerating} size="sm">
                  <LucideGithub style={{ width: 14, height: 14, marginRight: 4 }} />
                  Load
                </Button>
              </div>

              {/* Schema Editor */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted-foreground)' }}>
                  <span>{apiType.toUpperCase()} Schema</span>
                  <Button variant="ghost" size="sm" onClick={() => setSchemaInput(SAMPLE_SCHEMAS[apiType])}>
                    Load Sample
                  </Button>
                </div>
                <Textarea
                  value={schemaInput}
                  onChange={handleSchemaChange}
                  placeholder={`Paste your ${apiType.toUpperCase()} schema here...`}
                  style={{ flex: 1, border: 'none', resize: 'none', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.5, padding: 12, background: 'transparent', color: 'var(--foreground)' }}
                  spellCheck={false}
                />
              </div>
            </div>

            {/* Right Panel: Options */}
            <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 16, borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
              <Card>
                <CardHeader>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Client Configuration</h3>
                </CardHeader>
                <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                  <div>
                    <Label htmlFor="clientName">Client Name</Label>
                    <Input
                      id="clientName"
                      value={clientName}
                      onChange={e => setClientName(e.target.value)}
                      placeholder="api"
                      style={{ marginTop: 4 }}
                    />
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted-foreground)' }}>
                      Used as prefix for generated files (e.g., api-client.ts, api-hooks.ts)
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="baseUrl">Base URL</Label>
                    <Input
                      id="baseUrl"
                      value={baseUrl}
                      onChange={e => setBaseUrl(e.target.value)}
                      placeholder="https://api.example.com"
                      style={{ marginTop: 4 }}
                    />
                  </div>

                  <div>
                    <Label>Hook Library</Label>
                    <Select
                      value={hookLibrary}
                      onValueChange={setHookLibrary}
                      options={currentHookLibraries.map(l => ({
                        value: l.value,
                        label: l.label + (l.recommended ? ' (recommended)' : ''),
                      }))}
                      style={{ marginTop: 4 }}
                    />
                  </div>

                  <Separator />

                  <div>
                    <Label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <Checkbox
                        checked={includeComponents}
                        onCheckedChange={setIncludeComponents}
                      />
                      Generate UI Components
                    </Label>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted-foreground)' }}>
                      Creates ready-to-use components (tables, forms, lists) for each endpoint
                    </p>
                  </div>

                  <div>
                    <Label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <Checkbox
                        checked={includeAuth}
                        onCheckedChange={setIncludeAuth}
                      />
                      Include Authentication
                    </Label>
                    {includeAuth && (
                      <div style={{ marginTop: 8 }}>
                        <Label htmlFor="authType">Auth Type</Label>
                        <Select
                          id="authType"
                          value={authType}
                          onValueChange={setAuthType}
                          options={[
                            { value: 'bearer', label: 'Bearer Token (JWT)' },
                            { value: 'api-key', label: 'API Key Header' },
                            { value: 'cookie', label: 'Cookie/Session' },
                          ]}
                          style={{ marginTop: 4 }}
                        />
                      </div>
                    )}
                  </div>

                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Actions</h3>
                </CardHeader>
                <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Button onClick={handleGenerate} disabled={isGenerating || !schemaInput.trim()} className="w-full" style={{ justifyContent: 'center' }}>
                    {isGenerating ? (
                      <>
                        <LucidePlay style={{ width: 16, height: 16, marginRight: 8, animation: 'spin 1s linear infinite' }} />
                        Generating...
                      </>
                    ) : (
                      <>
                        <LucideZap style={{ width: 16, height: 16, marginRight: 8 }} />
                        Generate Client
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              <div style={{ marginTop: 'auto', padding: 12, background: 'var(--muted)', borderRadius: 8, fontSize: 12, color: 'var(--muted-foreground)' }}>
                <p style={{ margin: '0 0 8px', fontWeight: 500 }}>Supported Formats:</p>
                <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <li>OpenAPI 3.0/3.1 (JSON or YAML)</li>
                  <li>GraphQL Schema (SDL or Introspection JSON)</li>
                  <li>tRPC Router (TypeScript export)</li>
                </ul>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Tab: Preview */}
        <TabsContent value="preview" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {generatedClient ? (
            <div style={{ flex: 1, display: 'flex', padding: '20px', gap: 20, overflow: 'hidden' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Generated: {generatedClient.name}</h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(generatedClient.types)}>
                      <LucideCopy style={{ width: 14, height: 14, marginRight: 4 }} />
                      Copy Types
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(generatedClient.hooks)}>
                      <LucideCopy style={{ width: 14, height: 14, marginRight: 4 }} />
                      Copy Hooks
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(generatedClient.client)}>
                      <LucideCopy style={{ width: 14, height: 14, marginRight: 4 }} />
                      Copy Client
                    </Button>
                  </div>
                </div>

                <Tabs value={selectedFile >= 0 ? 'custom' : 'default'} onValueChange={() => {}} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <TabsList style={{ borderBottom: '1px solid var(--border)' }}>
                    <TabsTrigger value="types">
                      <LucideFileCode style={{ width: 14, height: 14, marginRight: 6 }} />
                      Types
                    </TabsTrigger>
                    <TabsTrigger value="hooks">
                      <LucideZap style={{ width: 14, height: 14, marginRight: 6 }} />
                      Hooks
                    </TabsTrigger>
                    <TabsTrigger value="client">
                      <LucideGithub style={{ width: 14, height: 14, marginRight: 6 }} />
                      Client
                    </TabsTrigger>
                    {includeComponents && (
                      <TabsTrigger value="components">
                        <LucideDatabase style={{ width: 14, height: 14, marginRight: 6 }} />
                        Components
                      </TabsTrigger>
                    )}
                  </TabsList>

                  <TabsContent value="types" style={{ flex: 1, overflow: 'auto', padding: 12 }}>
                    <CodeEditor
                      value={generatedClient.types}
                      language="typescript"
                      readOnly
                      style={{ height: '100%', minHeight: 300 }}
                    />
                  </TabsContent>

                  <TabsContent value="hooks" style={{ flex: 1, overflow: 'auto', padding: 12 }}>
                    <CodeEditor
                      value={generatedClient.hooks}
                      language="typescript"
                      readOnly
                      style={{ height: '100%', minHeight: 300 }}
                    />
                  </TabsContent>

                  <TabsContent value="client" style={{ flex: 1, overflow: 'auto', padding: 12 }}>
                    <CodeEditor
                      value={generatedClient.client}
                      language="typescript"
                      readOnly
                      style={{ height: '100%', minHeight: 300 }}
                    />
                  </TabsContent>

                  {includeComponents && (
                    <TabsContent value="components" style={{ flex: 1, overflow: 'auto', padding: 12 }}>
                      <CodeEditor
                        value={generatedClient.components}
                        language="tsx"
                        readOnly
                        style={{ height: '100%', minHeight: 300 }}
                      />
                    </TabsContent>
                  )}
                </Tabs>
              </div>

              <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 16, borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
                <Card>
                  <CardHeader>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Generated Files</h3>
                  </CardHeader>
                  <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflow: 'auto' }}>
                    {generatedClient.files.map((file, index) => (
                      <Button
                        key={file.path}
                        variant={selectedFile === index ? 'default' : 'outline'}
                        className="w-full justify-start"
                        onClick={() => setSelectedFile(index)}
                        style={{ padding: '8px 12px', fontSize: 12 }}
                      >
                        {file.path}
                      </Button>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Dependencies</h3>
                  </CardHeader>
                  <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {['zod', '@tanstack/react-query', 'axios'].map(dep => (
                      <Badge key={dep} variant="outline" style={{ justifyContent: 'flex-start' }}>
                        {dep}
                      </Badge>
                    ))}
                    {hookLibrary === 'urql' && <Badge key="urql" variant="outline">urql</Badge>}
                    {hookLibrary === 'apollo' && <Badge key="apollo" variant="outline">@apollo/client</Badge>}
                    {hookLibrary === 'swr' && <Badge key="swr" variant="outline">swr</Badge>}
                    {hookLibrary.startsWith('trpc') && <Badge key="trpc" variant="outline">@trpc/react-query</Badge>}
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)' }}>
              <p>Generate a client to see preview</p>
            </div>
          )}
        </TabsContent>

        {/* Tab: Files */}
        <TabsContent value="files" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {generatedClient ? (
            <div style={{ flex: 1, display: 'flex', padding: '20px', gap: 20, overflow: 'hidden' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>File Structure</h3>
                  <Button variant="outline" size="sm" onClick={() => {
                    const zip = new JSZip();
                    generatedClient.files.forEach(f => zip.file(f.path, f.content));
                    zip.generateAsync({ type: 'blob' }).then(blob => {
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${clientName}-client.zip`;
                      a.click();
                      URL.revokeObjectURL(url);
                    });
                  }}>
                    <LucideDownload style={{ width: 14, height: 14, marginRight: 4 }} />
                    Download All
                  </Button>
                </div>

                <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  {generatedClient.files.map((file, index) => (
                    <div key={file.path} style={{ borderBottom: index < generatedClient.files.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ padding: '8px 12px', background: selectedFile === index ? 'var(--muted)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: 13, fontFamily: 'monospace', color: selectedFile === index ? 'var(--primary)' : 'var(--foreground)' }} onClick={() => setSelectedFile(index)}>
                        <span>{file.path}</span>
                        <LucideEye style={{ width: 14, height: 14, opacity: selectedFile === index ? 1 : 0.5 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ width: 600, display: 'flex', flexDirection: 'column', minWidth: 0, borderLeft: '1px solid var(--border)' }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--muted)', fontSize: 13, fontFamily: 'monospace', color: 'var(--foreground)' }}>
                  {generatedClient.files[selectedFile]?.path || 'Select a file'}
                </div>
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <CodeEditor
                    value={generatedClient.files[selectedFile]?.content || ''}
                    language={generatedClient.files[selectedFile]?.path.endsWith('.tsx') ? 'tsx' : 'typescript'}
                    readOnly
                    style={{ height: '100%', minHeight: 400, borderRadius: 0 }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)' }}>
              <p>Generate a client to see files</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Simple JSZip polyfill for download
class JSZip {
  private files: Map<string, string> = new Map();
  file(name: string, content: string) { this.files.set(name, content); return this; }
  async generateAsync() { return new Blob([Array.from(this.files.values()).join('\n\n')], { type: 'application/zip' }); }
}

// Make it available globally for the download
if (typeof window !== 'undefined') {
  (window as any).JSZip = JSZip;
}

export default APIWizard;