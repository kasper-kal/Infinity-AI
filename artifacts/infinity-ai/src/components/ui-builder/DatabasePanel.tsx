/**
 * Database Panel — Connect external databases (Supabase, Firebase, Neon, PlanetScale, Turso, SQLite)
 * Schema introspection → typed client + CRUD components with real-time subscriptions
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
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
  LucideDatabase,
  LucidePlus,
  LucideTrash2,
  LucideRefreshCw,
  LucideCopy,
  LucideDownload,
  LucideCheck,
  LucideX,
  LucideTable,
  LucideKey,
  LucideShield,
  LucideZap,
  LucideEye,
  LucideEyeOff,
} from 'lucide-react';

interface DatabaseConnection {
  id: string;
  name: string;
  provider: 'supabase' | 'firebase' | 'neon' | 'planetscale' | 'turso' | 'sqlite';
  connectionString: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl: boolean;
}

interface SchemaTable {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    primaryKey: boolean;
    unique: boolean;
  }>;
}

interface DatabasePanelProps {
  onClose?: () => void;
  projectId?: string;
}

const PROVIDERS = [
  { value: 'supabase', label: 'Supabase', icon: LucideDatabase, description: 'Postgres + Auth + Realtime' },
  { value: 'firebase', label: 'Firebase', icon: LucideZap, description: 'Firestore + Auth' },
  { value: 'neon', label: 'Neon', icon: LucideDatabase, description: 'Serverless Postgres' },
  { value: 'planetscale', label: 'PlanetScale', icon: LucideDatabase, description: 'MySQL-compatible serverless' },
  { value: 'turso', label: 'Turso', icon: LucideDatabase, description: 'SQLite at the edge' },
  { value: 'sqlite', label: 'SQLite', icon: LucideDatabase, description: 'Local embedded database' },
] as const;

export function DatabasePanel({ onClose, projectId }: DatabasePanelProps) {
  const [activeTab, setActiveTab] = useState<'connections' | 'schema' | 'crud'>('connections');
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [selectedConn, setSelectedConn] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // New connection form
  const [connName, setConnName] = useState('');
  const [connProvider, setConnProvider] = useState<DatabaseConnection['provider']>('supabase');
  const [connString, setConnString] = useState('');
  const [connHost, setConnHost] = useState('');
  const [connPort, setConnPort] = useState<number>(5432);
  const [connDatabase, setConnDatabase] = useState('');
  const [connUsername, setConnUsername] = useState('');
  const [connPassword, setConnPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [sslEnabled, setSslEnabled] = useState(true);

  // Schema / CRUD
  const [schema, setSchema] = useState<SchemaTable[]>([]);
  const [crudComponents, setCrudComponents] = useState<Array<{ name: string; code: string }>>([]);
  const [rlsPolicies, setRlsPolicies] = useState<string[]>([]);
  const [selectedCrud, setSelectedCrud] = useState(0);
  const [realtime, setRealtime] = useState(false);

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/infinity/db-integration/connections?projectId=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections || []);
      }
    } catch (err) {
      console.error('Failed to load connections', err);
    }
  }, [projectId]);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  const handleAddConnection = useCallback(async () => {
    if (!projectId || !connName.trim() || !connString.trim()) {
      setError('Name and connection string are required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/infinity/db-integration/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: connName,
          provider: connProvider,
          connectionString: connString,
          host: connHost || undefined,
          port: connPort || undefined,
          database: connDatabase || undefined,
          username: connUsername || undefined,
          password: connPassword || undefined,
          ssl: sslEnabled,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save connection');
      }

      const conn = await res.json();
      setConnections(prev => [...prev, conn]);
      setSelectedConn(conn.id);
      setShowAddForm(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save connection');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, connName, connProvider, connString, connHost, connPort, connDatabase, connUsername, connPassword, sslEnabled]);

  const resetForm = () => {
    setConnName('');
    setConnProvider('supabase');
    setConnString('');
    setConnHost('');
    setConnPort(5432);
    setConnDatabase('');
    setConnUsername('');
    setConnPassword('');
    setSslEnabled(true);
  };

  const handleDeleteConnection = useCallback(async (id: string) => {
    try {
      await fetch(`/api/infinity/db-integration/connections/${id}`, { method: 'DELETE' });
      setConnections(prev => prev.filter(c => c.id !== id));
      if (selectedConn === id) setSelectedConn(null);
    } catch (err) {
      console.error('Delete failed', err);
    }
  }, [selectedConn]);

  const handleIntrospect = useCallback(async () => {
    if (!selectedConn) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/infinity/db-integration/introspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: selectedConn }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Introspection failed');
      }

      const data = await res.json();
      setSchema(data.tables || []);
      setActiveTab('schema');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Introspection failed');
    } finally {
      setIsLoading(false);
    }
  }, [selectedConn]);

  const handleGenerateCRUD = useCallback(async () => {
    if (!selectedConn || schema.length === 0) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/infinity/db-integration/generate-crud`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: selectedConn,
          generateTable: true,
          generateForm: true,
          generateList: true,
          realtime,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'CRUD generation failed');
      }

      const data = await res.json();
      setCrudComponents(data.components || []);
      setRlsPolicies(data.rlsPolicies || []);
      setActiveTab('crud');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CRUD generation failed');
    } finally {
      setIsLoading(false);
    }
  }, [selectedConn, schema, realtime]);

  return (
    <div className="database-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 600 }}>
      <div className="db-panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LucideDatabase style={{ width: 24, height: 24, color: 'var(--primary)' }} />
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Database Integration</h2>
        </div>
        <Tooltip content="Close">
          <IconButton onClick={onClose} variant="ghost" size="sm" aria-label="Close">
            <LucideX style={{ width: 16, height: 16 }} />
          </IconButton>
        </Tooltip>
      </div>

      {error && (
        <Alert variant="destructive" style={{ margin: '16px 20px', padding: '12px 16px' }}>
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <TabsList style={{ borderBottom: '1px solid var(--border)', padding: '0 20px' }}>
          <TabsTrigger value="connections" style={{ minWidth: 120 }}>
            <LucideDatabase style={{ width: 14, height: 14, marginRight: 6 }} />
            Connections
          </TabsTrigger>
          <TabsTrigger value="schema" disabled={!schema.length} style={{ minWidth: 100 }}>
            <LucideTable style={{ width: 14, height: 14, marginRight: 6 }} />
            Schema
          </TabsTrigger>
          <TabsTrigger value="crud" disabled={!crudComponents.length} style={{ minWidth: 100 }}>
            <LucideZap style={{ width: 14, height: 14, marginRight: 6 }} />
            CRUD
          </TabsTrigger>
        </TabsList>

        {/* Tab: Connections */}
        <TabsContent value="connections" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', padding: '20px', gap: 20, overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Database Connections</h3>
                <Button size="sm" onClick={() => { setShowAddForm(!showAddForm); setError(null); }}>
                  <LucidePlus style={{ width: 14, height: 14, marginRight: 4 }} />
                  Add Connection
                </Button>
              </div>

              {/* Add Connection Form */}
              {showAddForm && (
                <Card style={{ marginBottom: 16 }}>
                  <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <Label htmlFor="connName">Connection Name</Label>
                        <Input id="connName" value={connName} onChange={e => setConnName(e.target.value)} placeholder="My Database" style={{ marginTop: 4 }} />
                      </div>
                      <div>
                        <Label>Provider</Label>
                        <Select value={connProvider} onValueChange={setConnProvider} options={PROVIDERS.map(p => ({ value: p.value, label: p.label }))} style={{ marginTop: 4 }} />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="connString">Connection String</Label>
                      <Input id="connString" value={connString} onChange={e => setConnString(e.target.value)} placeholder="postgresql://user:pass@host:5432/db" style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 13 }} spellCheck={false} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                      <div>
                        <Label htmlFor="connHost">Host</Label>
                        <Input id="connHost" value={connHost} onChange={e => setConnHost(e.target.value)} placeholder="db.example.com" style={{ marginTop: 4 }} />
                      </div>
                      <div>
                        <Label htmlFor="connPort">Port</Label>
                        <Input id="connPort" type="number" value={connPort} onChange={e => setConnPort(parseInt(e.target.value) || 5432)} style={{ marginTop: 4 }} />
                      </div>
                      <div>
                        <Label htmlFor="connDatabase">Database</Label>
                        <Input id="connDatabase" value={connDatabase} onChange={e => setConnDatabase(e.target.value)} placeholder="mydb" style={{ marginTop: 4 }} />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <Label htmlFor="connUsername">Username</Label>
                        <Input id="connUsername" value={connUsername} onChange={e => setConnUsername(e.target.value)} placeholder="postgres" style={{ marginTop: 4 }} />
                      </div>
                      <div>
                        <Label htmlFor="connPassword">Password</Label>
                        <div style={{ position: 'relative', marginTop: 4 }}>
                          <Input
                            id="connPassword"
                            type={showPassword ? 'text' : 'password'}
                            value={connPassword}
                            onChange={e => setConnPassword(e.target.value)}
                            placeholder="••••••••"
                            style={{ paddingRight: 32 }}
                          />
                          <IconButton
                            onClick={() => setShowPassword(!showPassword)}
                            variant="ghost"
                            size="sm"
                            aria-label="Toggle password"
                            style={{ position: 'absolute', right: 4, top: 4 }}
                          >
                            {showPassword ? <LucideEyeOff style={{ width: 14, height: 14 }} /> : <LucideEye style={{ width: 14, height: 14 }} />}
                          </IconButton>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <Checkbox checked={sslEnabled} onCheckedChange={setSslEnabled} />
                        Use SSL/TLS
                      </Label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button variant="ghost" onClick={() => { setShowAddForm(false); resetForm(); setError(null); }}>
                          Cancel
                        </Button>
                        <Button onClick={handleAddConnection} disabled={isLoading}>
                          {isLoading ? 'Saving...' : 'Save Connection'}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Connection List */}
              <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {connections.length === 0 ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)' }}>
                    <p>No database connections yet. Add one to get started.</p>
                  </div>
                ) : (
                  connections.map(conn => (
                    <Card key={conn.id} style={{ borderColor: selectedConn === conn.id ? 'var(--primary)' : 'var(--border)' }}>
                      <CardContent style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <LucideDatabase style={{ width: 20, height: 20, color: 'var(--primary)' }} />
                          </div>
                          <div>
                            <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{conn.name}</p>
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-foreground)' }}>
                              {PROVIDERS.find(p => p.value === conn.provider)?.label || conn.provider}
                              {conn.database && ` · ${conn.database}`}
                            </p>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <Tooltip content="Introspect schema">
                            <IconButton onClick={() => { setSelectedConn(conn.id); handleIntrospect(); }} variant="ghost" size="sm" aria-label="Introspect">
                              <LucideRefreshCw style={{ width: 14, height: 14 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip content="Delete">
                            <IconButton onClick={() => handleDeleteConnection(conn.id)} variant="ghost" size="sm" aria-label="Delete">
                              <LucideTrash2 style={{ width: 14, height: 14, color: 'var(--destructive)' }} />
                            </IconButton>
                          </Tooltip>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>

            {/* Right Panel: Provider Info */}
            <div style={{ width: 320, borderLeft: '1px solid var(--border)', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Card>
                <CardHeader>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Supported Providers</h3>
                </CardHeader>
                <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {PROVIDERS.map(p => (
                    <div key={p.value} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: p.value !== 'sqlite' ? '1px solid var(--border)' : 'none' }}>
                      <p.icon style={{ width: 18, height: 18, color: 'var(--primary)' }} />
                      <div>
                        <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>{p.label}</p>
                        <p style={{ margin: 0, fontSize: 11, color: 'var(--muted-foreground)' }}>{p.description}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Features</h3>
                </CardHeader>
                <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <LucideTable style={{ width: 14, height: 14, color: 'var(--primary)' }} />
                    <span style={{ fontSize: 13 }}>Schema introspection</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <LucideZap style={{ width: 14, height: 14, color: 'var(--primary)' }} />
                    <span style={{ fontSize: 13 }}>CRUD components</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <LucideShield style={{ width: 14, height: 14, color: 'var(--primary)' }} />
                    <span style={{ fontSize: 13 }}>RLS policy generation</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <LucideRefreshCw style={{ width: 14, height: 14, color: 'var(--primary)' }} />
                    <span style={{ fontSize: 13 }}>Real-time subscriptions</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Tab: Schema */}
        <TabsContent value="schema" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', padding: '20px', gap: 20, overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Schema Tables ({schema.length})</h3>
                <Button size="sm" onClick={handleGenerateCRUD} disabled={isLoading}>
                  <LucideZap style={{ width: 14, height: 14, marginRight: 4 }} />
                  Generate CRUD
                </Button>
              </div>

              <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {schema.map(table => (
                  <Card key={table.name}>
                    <CardHeader style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <LucideTable style={{ width: 16, height: 16, color: 'var(--primary)' }} />
                        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{table.name}</h4>
                        <Badge variant="outline" style={{ marginLeft: 'auto' }}>{table.columns.length} columns</Badge>
                      </div>
                    </CardHeader>
                    <CardContent style={{ padding: '0 16px 12px' }}>
                      <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                        <table style={{ width: '100%', fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                              <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 500 }}>Column</th>
                              <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 500 }}>Type</th>
                              <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 500 }}>Null</th>
                              <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 500 }}>Key</th>
                            </tr>
                          </thead>
                          <tbody>
                            {table.columns.map(col => (
                              <tr key={col.name} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '6px 12px', fontFamily: 'monospace' }}>{col.name}</td>
                                <td style={{ padding: '6px 12px', fontFamily: 'monospace', color: 'var(--muted-foreground)' }}>{col.type}</td>
                                <td style={{ padding: '6px 12px' }}>{col.nullable ? '✓' : '✗'}</td>
                                <td style={{ padding: '6px 12px' }}>
                                  {col.primaryKey ? <Badge variant="default" style={{ fontSize: 10 }}>PK</Badge> : col.unique ? <Badge variant="outline" style={{ fontSize: 10 }}>UQ</Badge> : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <div style={{ width: 320, borderLeft: '1px solid var(--border)', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Card>
                <CardHeader>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>CRUD Options</h3>
                </CardHeader>
                <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <Checkbox checked={realtime} onCheckedChange={setRealtime} />
                    Generate real-time subscriptions
                  </Label>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-foreground)' }}>
                    Adds Supabase realtime listeners for live data updates in generated components.
                  </p>
                  <Separator />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button onClick={handleIntrospect} disabled={isLoading || !selectedConn} variant="outline" size="sm" className="w-full">
                      <LucideRefreshCw style={{ width: 14, height: 14, marginRight: 4 }} />
                      Re-introspect
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Generated Output</h3>
                </CardHeader>
                <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--muted-foreground)' }}>
                  <p style={{ margin: 0 }}>• TypeScript types for each table</p>
                  <p style={{ margin: 0 }}>• CRUD table/list/form components</p>
                  <p style={{ margin: 0 }}>• Typed database client (Drizzle/Kysely)</p>
                  <p style={{ margin: 0 }}>• RLS policies (Supabase/Postgres)</p>
                  {realtime && <p style={{ margin: 0 }}>• Real-time subscription hooks</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Tab: CRUD */}
        <TabsContent value="crud" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', padding: '20px', gap: 20, overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Generated Components ({crudComponents.length})</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="outline" size="sm" onClick={() => crudComponents.forEach(c => navigator.clipboard.writeText(c.code))}>
                    <LucideCopy style={{ width: 14, height: 14, marginRight: 4 }} />
                    Copy All
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => {
                    const blob = new Blob([crudComponents.map(c => c.code).join('\n\n')], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'crud-components.tsx';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}>
                    <LucideDownload style={{ width: 14, height: 14, marginRight: 4 }} />
                    Download
                  </Button>
                </div>
              </div>

              <div style={{ flex: 1, display: 'flex', gap: 12, overflow: 'hidden' }}>
                <div style={{ width: 240, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {crudComponents.map((comp, i) => (
                    <Button
                      key={comp.name}
                      variant={selectedCrud === i ? 'default' : 'outline'}
                      className="w-full justify-start"
                      onClick={() => setSelectedCrud(i)}
                      style={{ fontSize: 12 }}
                    >
                      {comp.name}
                    </Button>
                  ))}
                </div>

                <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <CodeEditor
                    value={crudComponents[selectedCrud]?.code || ''}
                    language="tsx"
                    readOnly
                    style={{ height: '100%', minHeight: 400 }}
                  />
                </div>
              </div>
            </div>

            {/* RLS Policies */}
            <div style={{ width: 360, borderLeft: '1px solid var(--border)', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Card style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <CardHeader>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <LucideShield style={{ width: 16, height: 16, color: 'var(--primary)' }} />
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>RLS Policies</h3>
                  </div>
                </CardHeader>
                <CardContent style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rlsPolicies.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                      No RLS policies for this provider. Row Level Security is only available for Supabase/Postgres.
                    </p>
                  ) : (
                    rlsPolicies.map((policy, i) => (
                      <div key={i} style={{ padding: 12, background: 'var(--muted)', borderRadius: 6, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', overflow: 'auto' }}>
                        {policy.length > 500 ? policy.slice(0, 500) + '...' : policy}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default DatabasePanel;