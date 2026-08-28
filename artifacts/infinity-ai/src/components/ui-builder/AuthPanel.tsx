/**
 * Auth Panel — Configure authentication providers (Clerk, Auth.js/NextAuth, Supabase, Firebase, custom JWT)
 * Generates auth guards, login/register forms, protected routes, and user profile components
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
  LucideShield,
  LucidePlus,
  LucideTrash2,
  LucideRefreshCw,
  LucideCopy,
  LucideDownload,
  LucideCheck,
  LucideX,
  LucideKey,
  LucideUsers,
  LucideLock,
  LucideUser,
  LucideEye,
  LucideEyeOff,
  LucideGithub,
  LucideGlobe,
  LucideZap,
  LucideDatabase,
} from 'lucide-react';

interface AuthProviderConfig {
  id: string;
  name: string;
  provider: 'clerk' | 'authjs' | 'supabase' | 'firebase' | 'custom-jwt';
  publishableKey?: string;
  secretKey?: string;
  domain?: string;
  audience?: string;
  redirectUrl?: string;
  scopes?: string[];
  options?: Record<string, any>;
  enabled: boolean;
}

interface GeneratedAuthCode {
  guards: Array<{ name: string; code: string; type: 'middleware' | 'hook' | 'component' | 'route' }>;
  forms: Array<{ name: string; code: string; type: 'login' | 'register' | 'profile' }>;
  protectedRoute: { name: string; code: string; type: 'route' };
}

interface AuthPanelProps {
  onClose?: () => void;
  projectId?: string;
}

const PROVIDERS = [
  { value: 'clerk', label: 'Clerk', icon: LucideUsers, description: 'Complete auth with user management, MFA, organizations', color: '#C44DFF' },
  { value: 'authjs', label: 'Auth.js (NextAuth)', icon: LucideShield, description: 'Flexible auth for Next.js with 50+ providers', color: '#000000' },
  { value: 'supabase', label: 'Supabase Auth', icon: LucideDatabase, description: 'Postgres-backed auth with row-level security', color: '#3ECF8E' },
  { value: 'firebase', label: 'Firebase Auth', icon: LucideZap, description: 'Google\'s auth with social providers, phone, anonymous', color: '#FFCA28' },
  { value: 'custom-jwt', label: 'Custom JWT', icon: LucideKey, description: 'Roll your own JWT with custom claims and validation', color: '#6366F1' },
] as const;

export function AuthPanel({ onClose, projectId }: AuthPanelProps) {
  const [activeTab, setActiveTab] = useState<'providers' | 'guards' | 'forms' | 'protected'>('providers');
  const [providers, setProviders] = useState<AuthProviderConfig[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // New provider form
  const [provName, setProvName] = useState('');
  const [provProvider, setProvProvider] = useState<AuthProviderConfig['provider']>('clerk');
  const [provPublishableKey, setProvPublishableKey] = useState('');
  const [provSecretKey, setProvSecretKey] = useState('');
  const [provDomain, setProvDomain] = useState('');
  const [provAudience, setProvAudience] = useState('');
  const [provRedirectUrl, setProvRedirectUrl] = useState('');
  const [provScopes, setProvScopes] = useState<string>('openid,profile,email');
  const [showSecretKey, setShowSecretKey] = useState(false);

  // Generated code
  const [generatedCode, setGeneratedCode] = useState<GeneratedAuthCode | null>(null);
  const [selectedGuard, setSelectedGuard] = useState(0);
  const [selectedForm, setSelectedForm] = useState(0);

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const loadProviders = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/infinity/auth-integration/providers?projectId=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setProviders(data.providers || []);
      }
    } catch (err) {
      console.error('Failed to load providers', err);
    }
  }, [projectId]);

  useEffect(() => { loadProviders(); }, [loadProviders]);

  const handleAddProvider = useCallback(async () => {
    if (!projectId || !provName.trim() || !provPublishableKey.trim()) {
      setError('Name and publishable key are required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/infinity/auth-integration/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: provName,
          provider: provProvider,
          publishableKey: provPublishableKey,
          secretKey: provSecretKey || undefined,
          domain: provDomain || undefined,
          audience: provAudience || undefined,
          redirectUrl: provRedirectUrl || undefined,
          scopes: provScopes.split(',').map(s => s.trim()).filter(Boolean),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save provider');
      }

      const provider = await res.json();
      setProviders(prev => [...prev, provider]);
      setSelectedProvider(provider.id);
      setShowAddForm(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save provider');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, provName, provProvider, provPublishableKey, provSecretKey, provDomain, provAudience, provRedirectUrl, provScopes]);

  const resetForm = () => {
    setProvName('');
    setProvProvider('clerk');
    setProvPublishableKey('');
    setProvSecretKey('');
    setProvDomain('');
    setProvAudience('');
    setProvRedirectUrl('');
    setProvScopes('openid,profile,email');
    setShowSecretKey(false);
  };

  const handleDeleteProvider = useCallback(async (id: string) => {
    try {
      await fetch(`/api/infinity/auth-integration/providers/${id}`, { method: 'DELETE' });
      setProviders(prev => prev.filter(p => p.id !== id));
      if (selectedProvider === id) setSelectedProvider(null);
      setGeneratedCode(null);
    } catch (err) {
      console.error('Delete failed', err);
    }
  }, [selectedProvider]);

  const handleGenerateCode = useCallback(async () => {
    if (!selectedProvider) return;
    const provider = providers.find(p => p.id === selectedProvider);
    if (!provider) return;

    setGenerating(true);
    setError(null);

    try {
      const res = await fetch(`/api/infinity/auth-integration/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: selectedProvider }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Code generation failed');
      }

      const code = await res.json();
      setGeneratedCode(code);
      setActiveTab('guards');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code generation failed');
    } finally {
      setGenerating(false);
    }
  }, [selectedProvider, providers]);

  return (
    <div className="auth-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 600 }}>
      <div className="auth-panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LucideShield style={{ width: 24, height: 24, color: 'var(--primary)' }} />
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Authentication Integration</h2>
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
          <TabsTrigger value="providers" style={{ minWidth: 120 }}>
            <LucideKey style={{ width: 14, height: 14, marginRight: 6 }} />
            Providers
          </TabsTrigger>
          <TabsTrigger value="guards" disabled={!generatedCode?.guards?.length} style={{ minWidth: 100 }}>
            <LucideShield style={{ width: 14, height: 14, marginRight: 6 }} />
            Guards
          </TabsTrigger>
          <TabsTrigger value="forms" disabled={!generatedCode?.forms?.length} style={{ minWidth: 100 }}>
            <LucideUser style={{ width: 14, height: 14, marginRight: 6 }} />
            Forms
          </TabsTrigger>
          <TabsTrigger value="protected" disabled={!generatedCode?.protectedRoute} style={{ minWidth: 130 }}>
            <LucideLock style={{ width: 14, height: 14, marginRight: 6 }} />
            Protected Route
          </TabsTrigger>
        </TabsList>

        {/* Tab: Providers */}
        <TabsContent value="providers" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', padding: '20px', gap: 20, overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Auth Providers</h3>
                <Button size="sm" onClick={() => { setShowAddForm(!showAddForm); setError(null); }}>
                  <LucidePlus style={{ width: 14, height: 14, marginRight: 4 }} />
                  Add Provider
                </Button>
              </div>

              {/* Add Provider Form */}
              {showAddForm && (
                <Card style={{ marginBottom: 16 }}>
                  <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <Label htmlFor="provName">Provider Name</Label>
                        <Input id="provName" value={provName} onChange={e => setProvName(e.target.value)} placeholder="My Auth" style={{ marginTop: 4 }} />
                      </div>
                      <div>
                        <Label>Provider</Label>
                        <Select value={provProvider} onValueChange={setProvProvider} options={PROVIDERS.map(p => ({ value: p.value, label: p.label }))} style={{ marginTop: 4 }} />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="provPublishableKey">Publishable Key / Client ID</Label>
                      <Input id="provPublishableKey" value={provPublishableKey} onChange={e => setProvPublishableKey(e.target.value)} placeholder="pk_test_... or client ID" style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 13 }} spellCheck={false} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <Label htmlFor="provSecretKey">Secret Key / Client Secret</Label>
                        <div style={{ position: 'relative', marginTop: 4 }}>
                          <Input
                            id="provSecretKey"
                            type={showSecretKey ? 'text' : 'password'}
                            value={provSecretKey}
                            onChange={e => setProvSecretKey(e.target.value)}
                            placeholder="sk_live_... or client secret"
                            style={{ paddingRight: 32, fontFamily: 'monospace', fontSize: 13 }}
                            spellCheck={false}
                          />
                          <IconButton
                            onClick={() => setShowSecretKey(!showSecretKey)}
                            variant="ghost"
                            size="sm"
                            aria-label="Toggle secret"
                            style={{ position: 'absolute', right: 4, top: 4 }}
                          >
                            {showSecretKey ? <LucideEyeOff style={{ width: 14, height: 14 }} /> : <LucideEye style={{ width: 14, height: 14 }} />}
                          </IconButton>
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="provDomain">Domain / Project URL</Label>
                        <Input id="provDomain" value={provDomain} onChange={e => setProvDomain(e.target.value)} placeholder="your-project.supabase.co or auth.example.com" style={{ marginTop: 4 }} />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <Label htmlFor="provAudience">Audience (optional)</Label>
                        <Input id="provAudience" value={provAudience} onChange={e => setProvAudience(e.target.value)} placeholder="api.example.com" style={{ marginTop: 4 }} />
                      </div>
                      <div>
                        <Label htmlFor="provRedirectUrl">Redirect URL (optional)</Label>
                        <Input id="provRedirectUrl" value={provRedirectUrl} onChange={e => setProvRedirectUrl(e.target.value)} placeholder="https://app.example.com/callback" style={{ marginTop: 4 }} />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="provScopes">Scopes (comma-separated)</Label>
                      <Input id="provScopes" value={provScopes} onChange={e => setProvScopes(e.target.value)} placeholder="openid,profile,email" style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 13 }} />
                    </div>

                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <Button variant="ghost" onClick={() => { setShowAddForm(false); resetForm(); setError(null); }}>
                        Cancel
                      </Button>
                      <Button onClick={handleAddProvider} disabled={isLoading}>
                        {isLoading ? 'Saving...' : 'Save Provider'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Provider List */}
              <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {providers.length === 0 ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)' }}>
                    <p>No auth providers configured. Add one to generate guards and forms.</p>
                  </div>
                ) : (
                  providers.map(provider => {
                    const providerInfo = PROVIDERS.find(p => p.value === provider.provider);
                    const Icon = providerInfo?.icon;
                    return (
                      <Card key={provider.id} style={{ borderColor: selectedProvider === provider.id ? 'var(--primary)' : 'var(--border)' }}>
                        <CardContent style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 8, background: providerInfo?.color || 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {Icon && <Icon style={{ width: 20, height: 20, color: 'white' }} />}
                            </div>
                            <div>
                              <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{provider.name}</p>
                              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-foreground)' }}>
                                {providerInfo?.label || provider.provider}
                                {provider.domain && ` · ${provider.domain}`}
                              </p>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <Tooltip content="Generate code">
                              <IconButton onClick={() => { setSelectedProvider(provider.id); handleGenerateCode(); }} variant="ghost" size="sm" aria-label="Generate" disabled={generating}>
                                {generating ? <LucideRefreshCw style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> : <LucideRefreshCw style={{ width: 14, height: 14 }} />}
                              </IconButton>
                            </Tooltip>
                            <Tooltip content="Delete">
                              <IconButton onClick={() => handleDeleteProvider(provider.id)} variant="ghost" size="sm" aria-label="Delete">
                                <LucideTrash2 style={{ width: 14, height: 14, color: 'var(--destructive)' }} />
                              </IconButton>
                            </Tooltip>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
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
                  {PROVIDERS.map(p => {
                    const Icon = p.icon;
                    return (
                      <div key={p.value} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: p.value !== 'custom-jwt' ? '1px solid var(--border)' : 'none' }}>
                        {Icon && <Icon style={{ width: 18, height: 18, color: p.color }} />}
                        <div>
                          <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>{p.label}</p>
                          <p style={{ margin: 0, fontSize: 11, color: 'var(--muted-foreground)' }}>{p.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Generated Output</h3>
                </CardHeader>
                <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--muted-foreground)' }}>
                  <p style={{ margin: 0 }}>• Middleware guards (server-side auth)</p>
                  <p style={{ margin: 0 }}>• React hooks (client-side auth)</p>
                  <p style={{ margin: 0 }}>• Protected components (RequireAuth)</p>
                  <p style={{ margin: 0 }}>• Login / Register / Profile forms</p>
                  <p style={{ margin: 0 }}>• Protected API route handlers</p>
                  <p style={{ margin: 0 }}>• Type-safe session handling</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Tab: Guards */}
        <TabsContent value="guards" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {generatedCode?.guards ? (
            <div style={{ flex: 1, display: 'flex', padding: '20px', gap: 20, overflow: 'hidden' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Generated Guards ({generatedCode.guards.length})</h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="outline" size="sm" onClick={() => generatedCode.guards.forEach(g => navigator.clipboard.writeText(g.code))}>
                      <LucideCopy style={{ width: 14, height: 14, marginRight: 4 }} />
                      Copy All
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => {
                      const blob = new Blob([generatedCode.guards.map(g => g.code).join('\n\n')], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'auth-guards.ts';
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
                    {generatedCode.guards.map((guard, i) => (
                      <Button
                        key={guard.name}
                        variant={selectedGuard === i ? 'default' : 'outline'}
                        className="w-full justify-start"
                        onClick={() => setSelectedGuard(i)}
                        style={{ fontSize: 12 }}
                      >
                        {guard.name} ({guard.type})
                      </Button>
                    ))}
                  </div>

                  <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <CodeEditor
                      value={generatedCode.guards[selectedGuard]?.code || ''}
                      language="typescript"
                      readOnly
                      style={{ height: '100%', minHeight: 400 }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)' }}>
              <p>Select a provider and click "Generate code" to see guards</p>
            </div>
          )}
        </TabsContent>

        {/* Tab: Forms */}
        <TabsContent value="forms" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {generatedCode?.forms ? (
            <div style={{ flex: 1, display: 'flex', padding: '20px', gap: 20, overflow: 'hidden' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Generated Forms ({generatedCode.forms.length})</h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="outline" size="sm" onClick={() => generatedCode.forms.forEach(f => navigator.clipboard.writeText(f.code))}>
                      <LucideCopy style={{ width: 14, height: 14, marginRight: 4 }} />
                      Copy All
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => {
                      const blob = new Blob([generatedCode.forms.map(f => f.code).join('\n\n')], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'auth-forms.tsx';
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
                    {generatedCode.forms.map((form, i) => (
                      <Button
                        key={form.name}
                        variant={selectedForm === i ? 'default' : 'outline'}
                        className="w-full justify-start"
                        onClick={() => setSelectedForm(i)}
                        style={{ fontSize: 12 }}
                      >
                        {form.name} ({form.type})
                      </Button>
                    ))}
                  </div>

                  <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <CodeEditor
                      value={generatedCode.forms[selectedForm]?.code || ''}
                      language="tsx"
                      readOnly
                      style={{ height: '100%', minHeight: 400 }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)' }}>
              <p>Select a provider and click "Generate code" to see forms</p>
            </div>
          )}
        </TabsContent>

        {/* Tab: Protected Route */}
        <TabsContent value="protected" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {generatedCode?.protectedRoute ? (
            <div style={{ flex: 1, display: 'flex', padding: '20px', gap: 20, overflow: 'hidden' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Protected Route Handler</h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(generatedCode.protectedRoute.code)}>
                      <LucideCopy style={{ width: 14, height: 14, marginRight: 4 }} />
                      Copy
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => {
                      const blob = new Blob([generatedCode.protectedRoute.code], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'protected-route.ts';
                      a.click();
                      URL.revokeObjectURL(url);
                    }}>
                      <LucideDownload style={{ width: 14, height: 14, marginRight: 4 }} />
                      Download
                    </Button>
                  </div>
                </div>

                <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <CodeEditor
                    value={generatedCode.protectedRoute.code}
                    language="typescript"
                    readOnly
                    style={{ height: '100%', minHeight: 400 }}
                  />
                </div>
              </div>

              <div style={{ width: 320, borderLeft: '1px solid var(--border)', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Card>
                  <CardHeader>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Usage</h3>
                  </CardHeader>
                  <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--muted-foreground)' }}>
                    <p style={{ margin: 0 }}>Add this route to your Next.js API routes:</p>
                    <p style={{ margin: 0, fontFamily: 'monospace', background: 'var(--muted)', padding: '8px', borderRadius: 4 }}>app/api/protected/route.ts</p>
                    <p style={{ margin: 0 }}>Use with fetch:</p>
                    <p style={{ margin: 0, fontFamily: 'monospace', background: 'var(--muted)', padding: '8px', borderRadius: 4, fontSize: 11 }}>
                      {"fetch('/api/protected', { headers: { Authorization: 'Bearer ' + token } })"}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)' }}>
              <p>Select a provider and click "Generate code" to see protected route</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default AuthPanel;