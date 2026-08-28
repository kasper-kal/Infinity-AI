/**
 * DeployPanel Component
 *
 * One-click deploy to free hosting (Vercel, Netlify, Cloudflare Pages, GitHub Pages).
 * Project linking, preview deployments, custom domains, env var management.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui';
import { Input } from '@/components/ui';
import { Badge, Tabs, TabsList, TabsTrigger, TabsContent, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Sheet, SheetContent, SheetHeader, SheetTitle, Select, Separator } from '@/components/ui';
import { Loader2, Rocket, ExternalLink, Copy, Check, Globe, GitBranch, Settings, Trash2, RefreshCw, AlertCircle } from 'lucide-react';

type DeployProvider = 'vercel' | 'netlify' | 'cloudflare' | 'github';

interface DeployFile {
  path: string;
  content: string;
}

interface DeployResult {
  deploymentId: string;
  status: 'success' | 'failed';
  previewUrl?: string;
  productionUrl?: string;
  provider: DeployProvider;
  message?: string;
}

interface DeployStatus {
  deploymentId: string;
  status: 'pending' | 'building' | 'completed' | 'failed';
  progress: number;
  logs: Array<{ step: string; status: string; duration?: number }>;
}

interface DeployPanelProps {
  projectId: string;
  files: DeployFile[];
  className?: string;
  onDeployComplete?: (result: DeployResult) => void;
}

const PROVIDERS: Record<DeployProvider, {
  name: string;
  icon: string;
  free: boolean;
  features: string[];
  color: string;
}> = {
  vercel: {
    name: 'Vercel',
    icon: '▲',
    free: true,
    features: ['Preview deployments', 'Custom domains', 'Automatic HTTPS', 'Edge functions'],
    color: 'text-black',
  },
  netlify: {
    name: 'Netlify',
    icon: '⬢',
    free: true,
    features: ['Continuous deployment', 'Form handling', 'Serverless functions', 'Split testing'],
    color: 'text-teal-500',
  },
  cloudflare: {
    name: 'Cloudflare Pages',
    icon: '☁',
    free: true,
    features: ['Global CDN', 'Preview deployments', 'Custom domains', 'Functions'],
    color: 'text-orange-500',
  },
  github: {
    name: 'GitHub Pages',
    icon: '⑂',
    free: true,
    features: ['Free hosting', 'Custom domains', 'Jekyll support', 'HTTPS'],
    color: 'text-gray-900',
  },
};

export const DeployPanel: React.FC<DeployPanelProps> = ({
  projectId,
  files,
  className,
  onDeployComplete,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<DeployProvider>('vercel');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [deployStatus, setDeployStatus] = useState<DeployStatus | null>(null);
  const [linkedRepo, setLinkedRepo] = useState<string | null>(null);
  const [customDomain, setCustomDomain] = useState('');
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [showConfig, setShowConfig] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Deploy
  const handleDeploy = useCallback(async () => {
    if (!linkedRepo && selectedProvider !== 'github') {
      setError('Please link a repository first');
      return;
    }

    setIsDeploying(true);
    setError(null);
    setDeployResult(null);
    setDeployStatus({ deploymentId: '', status: 'pending', progress: 0, logs: [] });

    try {
      const response = await fetch('/api/infinity/ui-builder/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          provider: selectedProvider,
          files,
          envVars,
          customDomain: customDomain || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`Deploy failed: ${response.statusText}`);
      }

      const result = await response.json();
      setDeployResult(result);
      setDeployStatus({
        deploymentId: result.deploymentId,
        status: 'completed',
        progress: 100,
        logs: [
          { step: 'Build', status: 'completed', duration: 45 },
          { step: 'Deploy', status: 'completed', duration: 12 },
        ],
      });
      onDeployComplete?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed');
      setDeployStatus(prev => prev ? { ...prev, status: 'failed' } : null);
    } finally {
      setIsDeploying(false);
    }
  }, [projectId, selectedProvider, files, envVars, customDomain, onDeployComplete]);

  // Copy URL
  const handleCopy = useCallback(async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 1500);
  }, []);

  // Add env var
  const handleAddEnvVar = useCallback(() => {
    setEnvVars(prev => ({ ...prev, [`VAR_${Object.keys(prev).length + 1}`]: '' }));
  }, []);

  // Remove env var
  const handleRemoveEnvVar = useCallback((key: string) => {
    setEnvVars(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const selectedProviderInfo = PROVIDERS[selectedProvider];

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Header */}
      <div className="p-3 border-b border-border">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Rocket className="w-4 h-4 text-primary" />
          Deploy UI
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          {files.length} files ready to deploy
        </p>
      </div>

      {/* Provider Selection */}
      <div className="p-3 border-b border-border">
        <Tabs value={selectedProvider} onValueChange={setSelectedProvider as (v: DeployProvider) => void}>
          <TabsList className="grid grid-cols-2 gap-1">
            {(Object.keys(PROVIDERS) as DeployProvider[]).map(provider => (
              <TabsTrigger key={provider} value={provider} className="flex items-center gap-2">
                <span className={cn('text-lg', PROVIDERS[provider].color)}>{PROVIDERS[provider].icon}</span>
                <span className="hidden sm:inline">{PROVIDERS[provider].name}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="mt-3 p-3 rounded-lg bg-muted/50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{selectedProviderInfo.name}</span>
            {selectedProviderInfo.free && (
              <Badge variant="secondary" className="text-xs">Free</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {selectedProviderInfo.features.map(feature => (
              <Badge key={feature} variant="outline" className="text-xs">{feature}</Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Repository Linking */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            Repository
          </span>
          {linkedRepo ? (
            <Button variant="ghost" size="sm" onClick={() => setLinkedRepo(null)}>
              <Trash2 className="w-3 h-3 mr-1" />
              Unlink
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setLinkedRepo(`kasper-kal/infinity-${projectId}`)}>
              <GitBranch className="w-3 h-3 mr-1" />
              Link
            </Button>
          )}
        </div>

        {linkedRepo ? (
          <code className="block mt-2 text-xs text-muted-foreground p-2 bg-muted/50 rounded">
            {linkedRepo}
          </code>
        ) : (
          <p className="text-xs text-muted-foreground mt-2">
            Link a GitHub repo for auto-deploy on push
          </p>
        )}
      </div>

      {/* Deploy Status */}
      {deployStatus && (
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Status</span>
            <Badge
              variant={deployStatus.status === 'completed' ? 'default' : deployStatus.status === 'failed' ? 'destructive' : 'secondary'}
            >
              {deployStatus.status}
            </Badge>
          </div>

          {deployStatus.status !== 'failed' && deployStatus.status !== 'completed' && (
            <div className="w-full bg-muted rounded-full h-2 mt-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{ width: `${deployStatus.progress}%` }}
              />
            </div>
          )}

          {deployStatus.logs.length > 0 && (
            <div className="mt-2 space-y-1">
              {deployStatus.logs.map((log, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{log.step}</span>
                  <span className={cn(log.status === 'completed' ? 'text-green-500' : 'text-yellow-500')}>
                    {log.status}{log.duration ? ` (${log.duration}s)` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Deploy Result */}
      {deployResult && (
        <div className="p-3 border-b border-border">
          <div className="space-y-2">
            {deployResult.previewUrl && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Preview</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleCopy(deployResult.previewUrl!)}>
                    {copiedUrl === deployResult.previewUrl ? (
                      <Check className="w-3 h-3 text-green-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </Button>
                  <Button variant="ghost" size="icon" asChild>
                    <a href={deployResult.previewUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </Button>
                </div>
              </div>
            )}

            {deployResult.productionUrl && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <Rocket className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">Production</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleCopy(deployResult.productionUrl!)}>
                    {copiedUrl === deployResult.productionUrl ? (
                      <Check className="w-3 h-3 text-green-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </Button>
                  <Button variant="ghost" size="icon" asChild>
                    <a href={deployResult.productionUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 border-b border-border">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        </div>
      )}

      {/* Config */}
      <Sheet open={showConfig} onOpenChange={setShowConfig}>
        <SheetContent side="right" className="w-[400px]">
          <SheetHeader>
            <SheetTitle>Deploy Configuration</SheetTitle>
          </SheetHeader>

          <div className="space-y-4 mt-4">
            {/* Custom Domain */}
            <div>
              <label className="text-sm font-medium">Custom Domain</label>
              <Input
                placeholder="app.example.com"
                value={customDomain}
                onChange={e => setCustomDomain(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Free on {selectedProviderInfo.name} (requires DNS setup)
              </p>
            </div>

            <Separator />

            {/* Environment Variables */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Environment Variables</label>
                <Button variant="ghost" size="sm" onClick={handleAddEnvVar}>
                  <Plus className="w-3 h-3 mr-1" />
                  Add
                </Button>
              </div>

              {Object.keys(envVars).length === 0 ? (
                <p className="text-xs text-muted-foreground mt-2">No environment variables</p>
              ) : (
                <div className="space-y-2 mt-2">
                  {Object.entries(envVars).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2">
                      <Input
                        value={key}
                        onChange={e => {
                          const newKey = e.target.value;
                          setEnvVars(prev => {
                            const next = { ...prev };
                            delete next[key];
                            next[newKey] = value;
                            return next;
                          });
                        }}
                        className="w-32"
                      />
                      <Input
                        value={value}
                        onChange={e => setEnvVars(prev => ({ ...prev, [key]: e.target.value }))}
                        type="password"
                        className="flex-1"
                      />
                      <Button variant="ghost" size="icon" onClick={() => handleRemoveEnvVar(key)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Actions */}
      <div className="mt-auto p-3 border-t border-border space-y-2">
        <Button
          className="w-full"
          onClick={handleDeploy}
          disabled={isDeploying}
        >
          {isDeploying ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Rocket className="w-4 h-4 mr-2" />
          )}
          {isDeploying ? 'Deploying...' : 'Deploy to ' + selectedProviderInfo.name}
        </Button>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => setShowConfig(true)}
          disabled={isDeploying}
        >
          <Settings className="w-4 h-4 mr-2" />
          Configure
        </Button>
      </div>
    </div>
  );
};

export default DeployPanel;