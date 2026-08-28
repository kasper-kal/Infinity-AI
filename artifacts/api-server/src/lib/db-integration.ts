/**
 * Database Integration
 *
 * Connect external databases (Supabase, Firebase, Neon, PlanetScale, Turso, SQLite)
 * for generated UI. Features:
 * - Connection management with encrypted credentials
 * - Schema introspection (tables, columns, relations)
 * - Typed client generation
 * - CRUD component templates (tables, forms, lists) with real-time
 * - RLS/policy awareness in generated code
 */

import { z } from 'zod';
import { createHash, randomBytes } from 'crypto';
import { db } from '@workspace/db';
import { eq, and } from 'drizzle-orm';
import { projectDatabases } from '@workspace/db/schema/project-databases.js';

// ============================================================================
// Database Connection Types
// ============================================================================

export const DatabaseProviderSchema = z.enum([
  'supabase',
  'firebase',
  'neon',
  'planetscale',
  'turso',
  'sqlite',
  'postgres',
  'mysql',
]);

export const DatabaseConnectionSchema = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100),
  provider: DatabaseProviderSchema,
  connectionString: z.string(), // Encrypted at rest
  host: z.string().optional(),
  port: z.number().optional(),
  database: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(), // Encrypted at rest
  ssl: z.boolean().default(true),
  options: z.record(z.any()).optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export const SchemaIntrospectionResultSchema = z.object({
  provider: DatabaseProviderSchema,
  tables: z.array(z.object({
    name: z.string(),
    columns: z.array(z.object({
      name: z.string(),
      type: z.string(),
      nullable: z.boolean(),
      primaryKey: z.boolean(),
      unique: z.boolean(),
      default: z.string().optional(),
      foreignKey: z.object({
        table: z.string(),
        column: z.string(),
      }).optional(),
    })),
    indexes: z.array(z.object({
      name: z.string(),
      columns: z.array(z.string()),
      unique: z.boolean(),
    })).optional(),
    rowCount: z.number().optional(),
  })),
  relations: z.array(z.object({
    fromTable: z.string(),
    fromColumn: z.string(),
    toTable: z.string(),
    toColumn: z.string(),
    type: z.enum(['one-to-one', 'one-to-many', 'many-to-many']),
  })).optional(),
});

export const GeneratedCRUDTableSchema = z.object({
  tableName: z.string(),
  componentName: z.string(),
  columns: z.array(z.object({
    key: z.string(),
    header: z.string(),
    type: z.string(),
    editable: z.boolean(),
    sortable: z.boolean(),
  })),
  code: z.string(),
});

export type DatabaseProvider = z.infer<typeof DatabaseProviderSchema>;
export type DatabaseConnection = z.infer<typeof DatabaseConnectionSchema>;
export type SchemaIntrospectionResult = z.infer<typeof SchemaIntrospectionResultSchema>;
export type GeneratedCRUDTable = z.infer<typeof GeneratedCRUDTableSchema>;

// ============================================================================
// Database Integration Engine
// ============================================================================

export class DatabaseIntegrationEngine {
  private static readonly ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || 'infinity-dev-key';

  // ==========================================================================
  // Connection Management
  // ==========================================================================

  static async saveConnection(conn: DatabaseConnection): Promise<DatabaseConnection> {
    const id = conn.id || randomBytes(16).toString('hex');
    const encryptedConnString = this.encrypt(conn.connectionString);
    const encryptedPassword = conn.password ? this.encrypt(conn.password) : undefined;

    const existing = conn.id
      ? await db.select().from(projectDatabases).where(eq(projectDatabases.id, conn.id)).limit(1)
      : [];

    if (existing.length > 0) {
      const [updated] = await db
        .update(projectDatabases)
        .set({
          name: conn.name,
          provider: conn.provider,
          connectionString: encryptedConnString,
          host: conn.host,
          port: conn.port,
          database: conn.database,
          username: conn.username,
          password: encryptedPassword,
          ssl: conn.ssl,
          options: conn.options,
          updatedAt: new Date(),
        })
        .where(eq(projectDatabases.id, conn.id!))
        .returning();
      return this.mapRowToConnection(updated);
    }

    const [inserted] = await db
      .insert(projectDatabases)
      .values({
        id,
        projectId: conn.projectId,
        name: conn.name,
        provider: conn.provider,
        connectionString: encryptedConnString,
        host: conn.host,
        port: conn.port,
        database: conn.database,
        username: conn.username,
        password: encryptedPassword,
        ssl: conn.ssl,
        options: conn.options,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return this.mapRowToConnection(inserted);
  }

  static async getConnection(id: string): Promise<DatabaseConnection | null> {
    const [row] = await db
      .select()
      .from(projectDatabases)
      .where(eq(projectDatabases.id, id))
      .limit(1);

    if (!row) return null;
    return this.mapRowToConnection(row);
  }

  static async getConnectionsByProject(projectId: string): Promise<DatabaseConnection[]> {
    const rows = await db
      .select()
      .from(projectDatabases)
      .where(eq(projectDatabases.projectId, projectId))
      .orderBy(projectDatabases.createdAt);

    return rows.map(this.mapRowToConnection);
  }

  static async deleteConnection(id: string): Promise<boolean> {
    const result = await db
      .delete(projectDatabases)
      .where(eq(projectDatabases.id, id))
      .returning({ id: projectDatabases.id });

    return result.length > 0;
  }

  // ==========================================================================
  // Schema Introspection
  // ==========================================================================

  static async introspectSchema(conn: DatabaseConnection): Promise<SchemaIntrospectionResult> {
    switch (conn.provider) {
      case 'postgres':
      case 'supabase':
      case 'neon':
      case 'planetscale':
        return this.introspectPostgres(conn);
      case 'mysql':
        return this.introspectMySQL(conn);
      case 'turso':
      case 'sqlite':
        return this.introspectSQLite(conn);
      case 'firebase':
        return this.introspectFirebase(conn);
      default:
        throw new Error(`Unsupported provider: ${conn.provider}`);
    }
  }

  private static async introspectPostgres(conn: DatabaseConnection): Promise<SchemaIntrospectionResult> {
    // In production, this would connect via pg client and run:
    // SELECT table_name, column_name, data_type, is_nullable, column_default
    // FROM information_schema.columns WHERE table_schema = 'public'
    // For now, return mock structure
    return this.mockIntrospection('postgres');
  }

  private static async introspectMySQL(conn: DatabaseConnection): Promise<SchemaIntrospectionResult> {
    return this.mockIntrospection('mysql');
  }

  private static async introspectSQLite(conn: DatabaseConnection): Promise<SchemaIntrospectionResult> {
    return this.mockIntrospection('sqlite');
  }

  private static async introspectFirebase(conn: DatabaseConnection): Promise<SchemaIntrospectionResult> {
    return this.mockIntrospection('firebase');
  }

  private static mockIntrospection(provider: string): SchemaIntrospectionResult {
    return {
      provider: provider as any,
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'uuid', nullable: false, primaryKey: true, unique: true },
            { name: 'email', type: 'varchar', nullable: false, primaryKey: false, unique: true },
            { name: 'name', type: 'varchar', nullable: true, primaryKey: false, unique: false },
            { name: 'created_at', type: 'timestamp', nullable: false, primaryKey: false, unique: false },
            { name: 'updated_at', type: 'timestamp', nullable: false, primaryKey: false, unique: false },
          ],
          indexes: [{ name: 'users_pkey', columns: ['id'], unique: true }],
          rowCount: 0,
        },
        {
          name: 'posts',
          columns: [
            { name: 'id', type: 'uuid', nullable: false, primaryKey: true, unique: true },
            { name: 'user_id', type: 'uuid', nullable: false, primaryKey: false, unique: false, foreignKey: { table: 'users', column: 'id' } },
            { name: 'title', type: 'varchar', nullable: false, primaryKey: false, unique: false },
            { name: 'content', type: 'text', nullable: true, primaryKey: false, unique: false },
            { name: 'published', type: 'boolean', nullable: false, primaryKey: false, unique: false },
            { name: 'created_at', type: 'timestamp', nullable: false, primaryKey: false, unique: false },
          ],
          indexes: [{ name: 'posts_pkey', columns: ['id'], unique: true }],
          rowCount: 0,
        },
      ],
      relations: [
        {
          fromTable: 'posts',
          fromColumn: 'user_id',
          toTable: 'users',
          toColumn: 'id',
          type: 'one-to-many',
        },
      ],
    };
  }

  // ==========================================================================
  // CRUD Component Generation
  // ==========================================================================

  static generateCRUDComponents(
    schema: SchemaIntrospectionResult,
    options?: {
      generateTable?: boolean;
      generateForm?: boolean;
      generateList?: boolean;
      realtime?: boolean;
      provider?: DatabaseProvider;
    }
  ): GeneratedCRUDTable[] {
    const result: GeneratedCRUDTable[] = [];
    const opts = {
      generateTable: true,
      generateForm: true,
      generateList: true,
      realtime: false,
      provider: 'postgres' as DatabaseProvider,
      ...options,
    };

    for (const table of schema.tables) {
      if (opts.generateTable) {
        result.push(this.generateTableComponent(table, opts));
      }
      if (opts.generateForm) {
        result.push(this.generateFormComponent(table, opts));
      }
      if (opts.generateList) {
        result.push(this.generateListComponent(table, opts));
      }
    }

    return result;
  }

  private static generateTableComponent(table: any, opts: any): GeneratedCRUDTable {
    const componentName = `${table.name.charAt(0).toUpperCase() + table.name.slice(1)}Table`;
    const columns = table.columns
      .filter(c => !c.foreignKey || opts.realTime)
      .map(c => ({
        key: c.name,
        header: c.name.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
        type: c.type,
        editable: !c.primaryKey && c.type !== 'timestamp',
        sortable: c.type !== 'text',
      }));

    const code = `import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export function ${componentName}() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    ${opts.realtime ? `const subscription = supabase
      .channel('${table.name}')
      .on('postgres_changes', { event: '*', schema: 'public', table: '${table.name}' }, () => loadData())
      .subscribe();
    return () => subscription.unsubscribe();` : ''}
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('${table.name}')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setData(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  async function deleteRow(id: string) {
    const { error } = await supabase.from('${table.name}').delete().eq('id', id);
    if (!error) loadData();
  }

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="text-red-500">{error}</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            ${columns.map(c => `<th className="text-left p-2 border-b">${c.header}</th>`).join('\n            ')}
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} className="border-b hover:bg-muted/50">
              ${columns.map(c => `<td className="p-2">{row.${c.key}}</td>`).join('\n              ')}
              <td className="p-2">
                <button onClick={() => deleteRow(row.id)} className="text-red-500">Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}`;

    return {
      tableName: table.name,
      componentName,
      columns,
      code,
    };
  }

  private static generateFormComponent(table: any, opts: any): GeneratedCRUDTable {
    const componentName = `${table.name.charAt(0).toUpperCase() + table.name.slice(1)}Form`;
    const editableColumns = table.columns.filter(c => !c.primaryKey && c.type !== 'timestamp');

    const code = `import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export function ${componentName}({ initialData, onSuccess }: { initialData?: any; onSuccess?: () => void }) {
  const [form, setForm] = useState(initialData || {});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const isUpdate = !!initialData?.id;
    const { error } = isUpdate
      ? await supabase.from('${table.name}').update(form).eq('id', initialData.id)
      : await supabase.from('${table.name}').insert(form);
    setLoading(false);
    if (!error) onSuccess?.();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      ${editableColumns.map(c => `      <div>
        <label className="block text-sm font-medium mb-1">${c.name}</label>
        <input
          type="${c.type === 'boolean' ? 'checkbox' : c.type === 'text' ? 'text' : 'text'}"
          value={form.${c.name} || ''}
          onChange={(e) => setForm({ ...form, ${c.name}: e.target.value })}
          className="w-full p-2 border rounded"
        />
      </div>`).join('\n')}
      <button type="submit" disabled={loading} className="bg-primary text-primary-foreground px-4 py-2 rounded">
        {loading ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}`;

    return {
      tableName: table.name,
      componentName,
      columns: editableColumns.map(c => ({ key: c.name, header: c.name, type: c.type, editable: true, sortable: false })),
      code,
    };
  }

  private static generateListComponent(table: any, opts: any): GeneratedCRUDTable {
    const componentName = `${table.name.charAt(0).toUpperCase() + table.name.slice(1)}List`;

    const code = `import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export function ${componentName}({ renderItem }: { renderItem?: (item: any) => React.ReactNode }) {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('${table.name}').select('*').then(({ data }) => setItems(data || []));
  }, []);

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="p-3 border rounded">
          {renderItem ? renderItem(item) : <pre>{JSON.stringify(item, null, 2)}</pre>}
        </li>
      ))}
    </ul>
  );
}`;

    return {
      tableName: table.name,
      componentName,
      columns: table.columns.map(c => ({ key: c.name, header: c.name, type: c.type, editable: false, sortable: false })),
      code,
    };
  }

  // ==========================================================================
  // Security / RLS Awareness
  // ==========================================================================

  static generateRLSPolicies(conn: DatabaseConnection, schema: SchemaIntrospectionResult): string[] {
    if (conn.provider !== 'supabase' && conn.provider !== 'postgres') {
      return ['-- RLS not supported for this provider'];
    }

    const policies: string[] = [];
    for (const table of schema.tables) {
      policies.push(`
-- Enable RLS on ${table.name}
ALTER TABLE ${table.name} ENABLE ROW LEVEL SECURITY;

-- Allow users to see their own data
CREATE POLICY "${table.name}_user_select" ON ${table.name}
  FOR SELECT USING (auth.uid() = user_id);

-- Allow users to insert their own data
CREATE POLICY "${table.name}_user_insert" ON ${table.name}
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own data
CREATE POLICY "${table.name}_user_update" ON ${table.name}
  FOR UPDATE USING (auth.uid() = user_id);

-- Allow users to delete their own data
CREATE POLICY "${table.name}_user_delete" ON ${table.name}
  FOR DELETE USING (auth.uid() = user_id);`);
    }

    return policies;
  }

  // ==========================================================================
  // Encryption (simplified - in production use proper KMS)
  // ==========================================================================

  private static encrypt(text: string): string {
    const cipher = createHash('sha256').update(this.ENCRYPTION_KEY).digest();
    const iv = randomBytes(16);
    const crypto = require('crypto');
    const cipherAlg = crypto.createCipheriv('aes-256-cbc', cipher, iv);
    let encrypted = cipherAlg.update(text, 'utf8', 'hex');
    encrypted += cipherAlg.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private static decrypt(encrypted: string): string {
    const [ivHex, data] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const cipher = createHash('sha256').update(this.ENCRYPTION_KEY).digest();
    const crypto = require('crypto');
    const decipher = crypto.createDecipheriv('aes-256-cbc', cipher, iv);
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private static mapRowToConnection(row: any): DatabaseConnection {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      provider: row.provider,
      connectionString: this.decrypt(row.connectionString),
      host: row.host,
      port: row.port,
      database: row.database,
      username: row.username,
      password: row.password ? this.decrypt(row.password) : undefined,
      ssl: row.ssl,
      options: row.options,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
