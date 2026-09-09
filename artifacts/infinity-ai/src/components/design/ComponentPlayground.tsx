/**
 * ComponentPlayground Component
 *
 * Isolated component rendering for testing components with editable props.
 * Features: state simulation (hover, focus, loading, error), responsive preview,
 * and export as story or test.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button, IconButton, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsList, TabsTrigger, TabsContent, Badge, Separator, ScrollArea, Card } from '@/components/ui';
import {
  Smartphone,
  Tablet,
  Monitor,
  Code,
  Copy,
  Download,
  RotateCcw,
  MousePointer,
  Zap,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Maximize2,
} from 'lucide-react';

interface ComponentProp {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
  controlType?: 'color' | 'spacing' | 'typography' | 'boolean' | 'enum' | 'string' | 'number';
  options?: string[];
  designTokenPath?: string;
}

interface ComponentRegistryEntry {
  name: string;
  filePath: string;
  displayName: string;
  category: string;
  props: ComponentProp[];
  exampleUsage: string;
  tags: string[];
}

interface DesignTokens {
  colors?: Record<string, Record<string, string>>;
  spacing?: Record<string, string>;
  typography?: Record<string, Record<string, string>>;
  borderRadius?: Record<string, string>;
  shadows?: Record<string, string>;
}

interface ComponentPlaygroundProps {
  componentRegistry: ComponentRegistryEntry[];
  designTokens: DesignTokens;
  onComponentSelect?: (component: ComponentRegistryEntry) => void;
  className?: string;
}

// Device configurations
const DEVICES = {
  mobile: { width: 393, height: 852, label: 'Mobile', icon: Smartphone, name: 'iPhone 16 Pro' },
  tablet: { width: 768, height: 1024, label: 'Tablet', icon: Tablet, name: 'iPad Pro' },
  desktop: { width: 1440, height: 900, label: 'Desktop', icon: Monitor, name: 'Desktop' },
} as const;

type DeviceKey = keyof typeof DEVICES;

interface PropValues {
  [key: string]: any;
}

interface SimulatedState {
  hover: boolean;
  focus: boolean;
  loading: boolean;
  error: boolean;
  disabled: boolean;
}

export const ComponentPlayground: React.FC<ComponentPlaygroundProps> = ({
  componentRegistry,
  designTokens,
  onComponentSelect,
  className,
}) => {
  const [selectedComponent, setSelectedComponent] = useState<ComponentRegistryEntry | null>(null);
  const [propValues, setPropValues] = useState<PropValues>({});
  const [device, setDevice] = useState<DeviceKey>('desktop');
  const [simulatedState, setSimulatedState] = useState<SimulatedState>({
    hover: false,
    focus: false,
    loading: false,
    error: false,
    disabled: false,
  });
  const [previewKey, setPreviewKey] = useState(0);
  const [showCode, setShowCode] = useState(false);
  const [exportFormat, setExportFormat] = useState<'story' | 'test' | 'jsx'>('story');
  const previewRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Initialize prop values when component changes
  useEffect(() => {
    if (!selectedComponent) {
      setPropValues({});
      return;
    }

    const defaults: PropValues = {};
    selectedComponent.props.forEach(prop => {
      if (prop.defaultValue !== undefined) {
        try {
          defaults[prop.name] = JSON.parse(prop.defaultValue);
        } catch {
          defaults[prop.name] = prop.defaultValue;
        }
      } else if (prop.type === 'boolean') {
        defaults[prop.name] = false;
      } else if (prop.type === 'number') {
        defaults[prop.name] = 0;
      } else if (prop.type === 'enum' && prop.options?.length) {
        defaults[prop.name] = prop.options[0];
      } else {
        defaults[prop.name] = '';
      }
    });
    setPropValues(defaults);
    setRenderError(null);
    setPreviewKey(prev => prev + 1);
  }, [selectedComponent]);

  // Handle prop changes
  const handlePropChange = useCallback((name: string, value: any) => {
    setPropValues(prev => ({ ...prev, [name]: value }));
    setPreviewKey(prev => prev + 1);
  }, []);

  // Handle simulated state changes
  const handleSimulatedStateChange = useCallback((state: Partial<SimulatedState>) => {
    setSimulatedState(prev => ({ ...prev, ...state }));
    setPreviewKey(prev => prev + 1);
  }, []);

  // Render component in preview
  const renderPreview = useCallback(() => {
    if (!selectedComponent) return null;

    try {
      // In a real implementation, this would dynamically import and render the component
      // For now, we render a placeholder that shows the component structure
      return (
        <ComponentPreview
          component={selectedComponent}
          props={{ ...propValues, ...simulatedState }}
          designTokens={designTokens}
          device={device}
          onError={setRenderError}
        />
      );
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : 'Render error');
      return null;
    }
  }, [selectedComponent, propValues, simulatedState, designTokens, device]);

  // Generate code for export
  const generateCode = useCallback(() => {
    if (!selectedComponent) return '';

    const props = Object.entries(propValues)
      .filter(([_, v]) => v !== '' && v !== false && v !== 0)
      .map(([k, v]) => {
        if (typeof v === 'string') return `${k}="${v}"`;
        if (typeof v === 'boolean') return v ? k : undefined;
        return `${k}={${JSON.stringify(v)}}`;
      })
      .filter(Boolean)
      .join(' ');

    switch (exportFormat) {
      case 'story':
        return `import type { Meta, StoryObj } from '@storybook/react';
import { ${selectedComponent.name} } from '${selectedComponent.filePath}';

const meta: Meta<typeof ${selectedComponent.name}> = {
  title: 'Components/${selectedComponent.displayName}',
  component: ${selectedComponent.name},
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ${selectedComponent.name}>;

export const Default: Story = {
  args: {
    ${Object.entries(propValues)
      .filter(([_, v]) => v !== '' && v !== false && v !== 0)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? `\`${v}\`` : JSON.stringify(v)}`)
      .join(',\n    ')}
  },
};`;

      case 'test':
        return `import { render, screen } from '@testing-library/react';
import { ${selectedComponent.name} } from '${selectedComponent.filePath}';

describe('${selectedComponent.displayName}', () => {
  it('renders correctly', () => {
    render(<${selectedComponent.name} ${props} />);
    expect(screen.getByRole('${selectedComponent.tagName?.toLowerCase() || 'button'}')).toBeInTheDocument();
  });

  it('handles interactions', () => {
    render(<${selectedComponent.name} ${props} />);
    // Add interaction tests here
  });
});`;

      default:
        return `<${selectedComponent.name} ${props} />`;
    }
  }, [selectedComponent, propValues, exportFormat]);

  // Copy code to clipboard
  const handleCopyCode = useCallback(async () => {
    const code = generateCode();
    await navigator.clipboard.writeText(code);
  }, [generateCode]);

  // Download code as file
  const handleDownloadCode = useCallback(() => {
    const code = generateCode();
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedComponent?.name}.${exportFormat === 'story' ? 'stories.tsx' : exportFormat === 'test' ? 'test.tsx' : 'jsx'}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedComponent, exportFormat, generateCode]);

  return (
    <div className={cn('component-playground', className)}>
      {/* Header */}
      <div className="playground-header flex items-center justify-between p-4 border-b border-border-primary">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Component Playground</h2>
          {selectedComponent && (
            <Badge variant="secondary">{selectedComponent.displayName}</Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Device selector */}
          <Select value={device} onValueChange={setDevice as any} className="w-36">
            <SelectTrigger>
              <SelectValue placeholder="Device" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DEVICES).map(([key, config]) => (
                <SelectItem key={key} value={key as DeviceKey}>
                  <div className="flex items-center gap-2">
                    <config.icon className="w-4 h-4" />
                    <span>{config.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Export format */}
          <Select value={exportFormat} onValueChange={setExportFormat as any} className="w-28">
            <SelectTrigger>
              <SelectValue placeholder="Export" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="story">
                <Code className="w-4 h-4 mr-2" />
                Storybook Story
              </SelectItem>
              <SelectItem value="test">
                <CheckCircle className="w-4 h-4 mr-2" />
                Test File
              </SelectItem>
              <SelectItem value="jsx">
                <MousePointer className="w-4 h-4 mr-2" />
                JSX Snippet
              </SelectItem>
            </SelectContent>
          </Select>

          <IconButton
            variant="ghost"
            size="sm"
            onClick={handleCopyCode}
            title="Copy code"
          >
            <Copy className="w-4 h-4" />
          </IconButton>
          <IconButton
            variant="ghost"
            size="sm"
            onClick={handleDownloadCode}
            title="Download code"
          >
            <Download className="w-4 h-4" />
          </IconButton>
        </div>
      </div>

      <Separator />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Component Selector */}
        {!selectedComponent && (
          <div className="flex-1 flex flex-col p-4 overflow-auto">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Select a Component</h3>
            <div className="flex-1 overflow-auto">
              <ComponentRegistryList
                registry={componentRegistry}
                onSelect={setSelectedComponent}
                designTokens={designTokens}
              />
            </div>
          </div>
        )}

        {selectedComponent && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Tabs: Preview / Props / Code */}
            <Tabs value={showCode ? 'code' : 'preview'} onValueChange={v => setShowCode(v === 'code')} className="flex-1 flex flex-col">
              <TabsList className="border-b border-border-primary">
                <TabsTrigger value="preview" className="flex-1">
                  <div className="flex items-center gap-2">
                    <MousePointer className="w-4 h-4" />
                    Preview
                    {renderError && <AlertTriangle className="w-3 h-3 text-destructive" />}
                  </div>
                </TabsTrigger>
                <TabsTrigger value="code" className="flex-1">
                  <div className="flex items-center gap-2">
                    <Code className="w-4 h-4" />
                    Code
                  </div>
                </TabsTrigger>
              </TabsList>

              {/* Preview Tab */}
              <TabsContent value="preview" className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Simulated State Controls */}
                  <div className="p-3 border-b border-border-primary bg-muted/30">
                    <label className="text-xs font-medium text-muted-foreground mr-3">Simulate:</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { key: 'hover', label: 'Hover', icon: MousePointer },
                        { key: 'focus', label: 'Focus', icon: Zap },
                        { key: 'loading', label: 'Loading', icon: RotateCcw },
                        { key: 'error', label: 'Error', icon: AlertTriangle },
                        { key: 'disabled', label: 'Disabled', icon: XCircle },
                      ].map(({ key, label, icon: Icon }) => (
                        <label key={key} className="flex items-center gap-1 px-2 py-1 rounded bg-background border border-border-primary cursor-pointer hover:bg-muted">
                          <input
                            type="checkbox"
                            checked={simulatedState[key as keyof SimulatedState]}
                            onChange={e => handleSimulatedStateChange({ [key]: e.target.checked })}
                            className="w-3 h-3 rounded border-border-primary"
                          />
                          <Icon className="w-3 h-3" />
                          <span className="text-xs">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Preview Area */}
                  <div className="flex-1 flex items-center justify-center overflow-auto bg-background p-4" style={{ background: '#f8fafc' }}>
                    <div
                      className="preview-container"
                      style={{
                        width: DEVICES[device].width,
                        height: DEVICES[device].height,
                        background: 'white',
                        borderRadius: device === 'mobile' ? '24px' : device === 'tablet' ? '16px' : '0',
                        boxShadow: device !== 'desktop' ? '0 25px 50px -12px rgba(0, 0, 0, 0.25)' : 'none',
                        border: device === 'desktop' ? '1px solid #e2e8f0' : 'none',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        ref={previewRef}
                        className="w-full h-full"
                        style={{
                          transform: `scale(${Math.min(1, window.innerWidth / (DEVICES[device].width + 40))})`,
                          transformOrigin: 'top center',
                        }}
                      >
                        {renderPreview()}
                      </div>
                    </div>
                  </div>

                  {/* Device info */}
                  <div className="p-3 border-t border-border-primary bg-muted/30 text-center text-sm text-muted-foreground">
                    {DEVICES[device].name} — {DEVICES[device].width}×{DEVICES[device].height}
                  </div>
                </div>
              </TabsContent>

              {/* Code Tab */}
              <TabsContent value="code" className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 flex flex-col">
                  <div className="p-3 border-b border-border-primary bg-muted/30 flex items-center justify-between">
                    <h3 className="text-sm font-medium">Generated {exportFormat.charAt(0).toUpperCase() + exportFormat.slice(1)}</h3>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={handleCopyCode}>
                        <Copy className="w-4 h-4 mr-1" />
                        Copy
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleDownloadCode}>
                        <Download className="w-4 h-4 mr-1" />
                        Download
                      </Button>
                    </div>
                  </div>
                  <pre className="flex-1 p-4 overflow-auto bg-black text-green-300 font-mono text-sm">
                    <code>{generateCode()}</code>
                  </pre>
                </div>
              </TabsContent>
            </Tabs>

            {/* Props Editor Panel */}
            <div className="w-full border-t border-border-primary bg-background">
              <div className="p-3 border-b border-border-primary flex items-center justify-between">
                <h3 className="text-sm font-medium">Props Editor</h3>
                <IconButton
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedComponent(null);
                    onComponentSelect?.(null as any);
                  }}
                >
                  <RotateCcw className="w-4 h-4" />
                </IconButton>
              </div>

              <ScrollArea className="max-h-64 p-3">
                <div className="space-y-3">
                  {selectedComponent.props.map(prop => (
                    <PropControl
                      key={prop.name}
                      prop={prop}
                      value={propValues[prop.name]}
                      onChange={handlePropChange}
                      designTokens={designTokens}
                    />
                  ))}

                  {selectedComponent.props.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No configurable props for this component
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Component Registry List
interface ComponentRegistryListProps {
  registry: ComponentRegistryEntry[];
  onSelect: (component: ComponentRegistryEntry) => void;
  designTokens: DesignTokens;
}

const ComponentRegistryList: React.FC<ComponentRegistryListProps> = ({
  registry,
  onSelect,
  designTokens,
}) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');

  const categories = useMemo(() => {
    const cats = new Set(registry.map(c => c.category));
    return ['all', ...Array.from(cats).sort()];
  }, [registry]);

  const filtered = registry.filter(c => {
    const matchesSearch = c.displayName.toLowerCase().includes(search.toLowerCase()) ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.tags.some(t => t.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory = category === 'all' || c.category === category;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-4">
      {/* Search and filter */}
      <div className="flex gap-2">
        <Input
          placeholder="Search components..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1"
        />
        <Select value={category} onValueChange={setCategory} className="w-36">
          <SelectTrigger>
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map(cat => (
              <SelectItem key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Component grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(component => (
          <Card
            key={component.name}
            className="p-3 cursor-pointer hover:border-brand-500/50 transition-colors"
            onClick={() => onSelect(component)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-medium truncate">{component.displayName}</h4>
                  {component.tags.includes('shadcn') && (
                    <Badge variant="secondary" className="text-xs">shadcn</Badge>
                  )}
                  {component.tags.includes('radix') && (
                    <Badge variant="outline" className="text-xs">radix</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{component.filePath}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {component.props.slice(0, 4).map(p => (
                    <Badge key={p.name} variant="outline" className="text-[10px]">{p.name}</Badge>
                  ))}
                  {component.props.length > 4 && (
                    <Badge variant="outline" className="text-[10px]">+{component.props.length - 4}</Badge>
                  )}
                </div>
              </div>
              <MousePointer className="w-5 h-5 text-muted-foreground opacity-50" />
            </div>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <MousePointer className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>No components found</p>
        </div>
      )}
    </div>
  );
};

// Prop Control Component
interface PropControlProps {
  prop: ComponentProp;
  value: any;
  onChange: (name: string, value: any) => void;
  designTokens: DesignTokens;
}

const PropControl: React.FC<PropControlProps> = ({ prop, value, onChange, designTokens }) => {
  const [showSuggestions, setShowSuggestions] = useState(false);

  const renderControl = () => {
    const tokenPath = prop.designTokenPath;
    const tokenValues = tokenPath ? getTokenOptions(designTokens, tokenPath) : [];

    switch (prop.controlType) {
      case 'boolean':
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value}
              onChange={e => onChange(prop.name, e.target.checked)}
              className="w-4 h-4 rounded border-border-primary bg-background"
            />
            <span className="text-sm">{prop.name}</span>
          </label>
        );

      case 'color':
        return (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{prop.name}</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={value?.startsWith('#') ? value : '#000000'}
                onChange={e => onChange(prop.name, e.target.value)}
                className="w-8 h-8 rounded border border-border-primary cursor-pointer"
              />
              <input
                type="text"
                value={value || ''}
                onChange={e => onChange(prop.name, e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="flex-1 px-2 py-1 text-sm border border-border-primary rounded bg-background"
                list={tokenValues.length > 0 ? `color-suggestions-${prop.name}` : undefined}
              />
              {tokenValues.length > 0 && showSuggestions && (
                <datalist id={`color-suggestions-${prop.name}`}>
                  {tokenValues.map(t => <option key={t} value={t} />)}
                </datalist>
              )}
            </div>
          </div>
        );

      case 'spacing':
        return (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{prop.name}</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={value || ''}
                onChange={e => onChange(prop.name, e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="flex-1 px-2 py-1 text-sm border border-border-primary rounded bg-background"
                list={tokenValues.length > 0 ? `spacing-suggestions-${prop.name}` : undefined}
              />
              {tokenValues.length > 0 && showSuggestions && (
                <datalist id={`spacing-suggestions-${prop.name}`}>
                  {tokenValues.map(t => <option key={t} value={t} />)}
                </datalist>
              )}
            </div>
          </div>
        );

      case 'typography':
        return (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{prop.name}</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={value || ''}
                onChange={e => onChange(prop.name, e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="flex-1 px-2 py-1 text-sm border border-border-primary rounded bg-background"
                list={tokenValues.length > 0 ? `typo-suggestions-${prop.name}` : undefined}
              />
              {tokenValues.length > 0 && showSuggestions && (
                <datalist id={`typo-suggestions-${prop.name}`}>
                  {tokenValues.map(t => <option key={t} value={t} />)}
                </datalist>
              )}
            </div>
          </div>
        );

      case 'enum':
        return (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{prop.name}</label>
            <Select value={String(value)} onValueChange={v => onChange(prop.name, v)} className="w-full">
              <SelectTrigger>
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {prop.options?.map(opt => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );

      case 'number':
        return (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{prop.name}</label>
            <input
              type="number"
              value={value || 0}
              onChange={e => onChange(prop.name, Number(e.target.value))}
              className="w-full px-2 py-1 text-sm border border-border-primary rounded bg-background"
            />
          </div>
        );

      default:
        return (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{prop.name}</label>
            <input
              type="text"
              value={value || ''}
              onChange={e => onChange(prop.name, e.target.value)}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              className="w-full px-2 py-1 text-sm border border-border-primary rounded bg-background"
              list={tokenValues.length > 0 ? `suggestions-${prop.name}` : undefined}
            />
            {tokenValues.length > 0 && showSuggestions && (
              <datalist id={`suggestions-${prop.name}`}>
                {tokenValues.map(t => <option key={t} value={t} />)}
              </datalist>
            )}
          </div>
        );
    }
  };

  return (
    <div className="p-3 bg-muted/30 rounded-lg">
      {renderControl()}
      {prop.description && <p className="text-xs text-muted-foreground mt-1">{prop.description}</p>}
    </div>
  );
};

// Component Preview Component (renders the actual component in the playground)
interface ComponentPreviewProps {
  component: ComponentRegistryEntry;
  props: PropValues;
  designTokens: DesignTokens;
  device: DeviceKey;
  onError: (error: string | null) => void;
}

// Shared constants for iframe rendering (same as LivePreview)
const TAILWIND_CDN = `
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            border: 'hsl(var(--border))',
            input: 'hsl(var(--input))',
            ring: 'hsl(var(--ring))',
            background: 'hsl(var(--background))',
            foreground: 'hsl(var(--foreground))',
            primary: {
              DEFAULT: 'hsl(var(--primary))',
              foreground: 'hsl(var(--primary-foreground))',
            },
            secondary: {
              DEFAULT: 'hsl(var(--secondary))',
              foreground: 'hsl(var(--secondary-foreground))',
            },
            destructive: {
              DEFAULT: 'hsl(var(--destructive))',
              foreground: 'hsl(var(--destructive-foreground))',
            },
            muted: {
              DEFAULT: 'hsl(var(--muted))',
              foreground: 'hsl(var(--muted-foreground))',
            },
            accent: {
              DEFAULT: 'hsl(var(--accent))',
              foreground: 'hsl(var(--accent-foreground))',
            },
            popover: {
              DEFAULT: 'hsl(var(--popover))',
              foreground: 'hsl(var(--popover-foreground))',
            },
            card: {
              DEFAULT: 'hsl(var(--card))',
              foreground: 'hsl(var(--card-foreground))',
            },
          },
          borderRadius: {
            lg: 'var(--radius)',
            md: 'calc(var(--radius) - 2px)',
            sm: 'calc(var(--radius) - 4px)',
          },
          fontFamily: {
            sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
          },
        },
      },
    };
  </script>
`;

const REACT_CDN = `
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
`;

const SHADCN_UTILS = `
  const cn = (...classes) => classes.filter(Boolean).join(' ');
`;

const CSS_VARIABLES = `
  <style>
    :root {
      --background: 0 0% 100%;
      --foreground: 222.2 84% 4.9%;
      --card: 0 0% 100%;
      --card-foreground: 222.2 84% 4.9%;
      --popover: 0 0% 100%;
      --popover-foreground: 222.2 84% 4.9%;
      --primary: 221.2 83.2% 53.3%;
      --primary-foreground: 210 40% 98%;
      --secondary: 210 40% 96.1%;
      --secondary-foreground: 222.2 47.4% 11.2%;
      --muted: 210 40% 96.1%;
      --muted-foreground: 215.4 16.3% 46.9%;
      --accent: 210 40% 96.1%;
      --accent-foreground: 222.2 47.4% 11.2%;
      --destructive: 0 84.2% 60.2%;
      --destructive-foreground: 210 40% 98%;
      --border: 214.3 31.8% 91.4%;
      --input: 214.3 31.8% 91.4%;
      --ring: 221.2 83.2% 53.3%;
      --radius: 0.5rem;
      --font-sans: 'Inter', system-ui, sans-serif;
    }
    .dark {
      --background: 222.2 84% 4.9%;
      --foreground: 210 40% 98%;
      --card: 222.2 84% 4.9%;
      --card-foreground: 210 40% 98%;
      --popover: 222.2 84% 4.9%;
      --popover-foreground: 210 40% 98%;
      --primary: 217.2 91.2% 59.8%;
      --primary-foreground: 222.2 47.4% 11.2%;
      --secondary: 217.2 32.6% 17.5%;
      --secondary-foreground: 210 40% 98%;
      --muted: 217.2 32.6% 17.5%;
      --muted-foreground: 215 20.2% 65.1%;
      --accent: 217.2 32.6% 17.5%;
      --accent-foreground: 210 40% 98%;
      --destructive: 0 62.8% 30.6%;
      --destructive-foreground: 210 40% 98%;
      --border: 217.2 32.6% 17.5%;
      --input: 217.2 32.6% 17.5%;
      --ring: 224.3 76.3% 48%;
    }
    * { border-color: hsl(var(--border)); }
    body { @apply bg-background text-foreground; font-family: var(--font-sans); }
  </style>
`;

// Component Preview Component (renders the actual component in the playground via iframe)
interface ComponentPreviewProps {
  component: ComponentRegistryEntry;
  props: PropValues;
  designTokens: DesignTokens;
  device: DeviceKey;
  onError: (error: string | null) => void;
}

const ComponentPreview: React.FC<ComponentPreviewProps> = ({
  component,
  props,
  designTokens,
  device,
  onError,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewKey = useRef(0);
  const [isLoading, setIsLoading] = useState(true);

  // Generate preview HTML
  const generatePreviewHTML = useCallback(() => {
    // Build the component code with props applied
    const propString = Object.entries(props)
      .filter(([_, v]) => v !== '' && v !== false && v !== 0 && v !== undefined)
      .map(([k, v]) => {
        if (typeof v === 'string') return `${k}="${v}"`;
        if (typeof v === 'boolean') return v ? k : undefined;
        if (typeof v === 'number') return `${k}={${v}}`;
        return `${k}={${JSON.stringify(v)}}`;
      })
      .filter(Boolean)
      .join(' ');

    // Extract imports from example usage
    const importMatches = component.exampleUsage.match(/^import .+ from ['"].+['"];/gm) || [];
    const imports = importMatches
      .filter(imp => !imp.startsWith('import ') || !imp.includes('@/') && !imp.includes('./') && !imp.includes('../'))
      .map(imp => imp.trim())
      .join('\n');

    // Get component definition from example usage (remove imports)
    const componentCode = component.exampleUsage
      .split('\n')
      .filter(line => !line.trim().startsWith('import '))
      .join('\n');

    // Create CSS variables from design tokens
    const cssVars: string[] = [];
    if (designTokens.colors) {
      Object.entries(designTokens.colors).forEach(([palette, shades]) => {
        Object.entries(shades).forEach(([shade, value]) => {
          cssVars.push(`  --color-${palette}-${shade}: ${value};`);
        });
      });
    }
    if (designTokens.spacing) {
      Object.entries(designTokens.spacing).forEach(([key, value]) => {
        cssVars.push(`  --spacing-${key}: ${value};`);
      });
    }
    const cssVarsString = cssVars.join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Component Preview - ${component.name}</title>
  ${TAILWIND_CDN}
  ${REACT_CDN}
  <style>
    :root {
${cssVarsString}
    }
    * { border-color: hsl(var(--border)); }
    body { @apply bg-background text-foreground; font-family: var(--font-sans); margin: 0; padding: 1.5rem; min-height: 100vh; }
    #root { width: 100%; }
    .preview-container { max-width: 100%; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react,typescript">
    ${SHADCN_UTILS}
    ${imports}

    ${componentCode}

    const App = () => (
      <div className="preview-container">
        <${component.name} ${propString} />
      </div>
    );

    // Override console for capture
    const originalConsole = { ...console };
    ['log', 'error', 'warn'].forEach(method => {
      console[method] = (...args) => {
        originalConsole[method](...args);
        window.parent.postMessage({
          type: 'console',
          payload: { type: method, message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') }
        }, '*');
      };
    });

    // Handle errors
    window.addEventListener('error', (event) => {
      window.parent.postMessage({
        type: 'error',
        payload: { message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno }
      }, '*');
    });

    // Notify parent when ready
    window.parent.postMessage({ type: 'preview-ready' }, '*');

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(React.createElement(App));
  </script>
</body>
</html>`;
  }, [component, props, designTokens]);

  // Render preview in iframe
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    setIsLoading(true);
    onError(null);

    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'preview-ready') {
        setIsLoading(false);
      } else if (event.data.type === 'error') {
        onError(event.data.payload.message);
        setIsLoading(false);
      } else if (event.data.type === 'console') {
        // Could forward console logs if needed
      }
    };

    window.addEventListener('message', handleMessage);

    const html = generatePreviewHTML();
    iframe.srcdoc = html;

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [generatePreviewHTML, onError]);

  // Apply design tokens as CSS variables for the container
  const containerStyle = useMemo(() => {
    const vars: Record<string, string> = {};
    if (designTokens.colors) {
      Object.entries(designTokens.colors).forEach(([palette, shades]) => {
        Object.entries(shades).forEach(([shade, value]) => {
          vars[`--color-${palette}-${shade}`] = value;
        });
      });
    }
    if (designTokens.spacing) {
      Object.entries(designTokens.spacing).forEach(([key, value]) => {
        vars[`--spacing-${key}`] = value;
      });
    }
    return vars;
  }, [designTokens]);

  return (
    <div style={containerStyle as React.CSSProperties} className="w-full h-full p-4">
      <div className="w-full h-full relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Rendering component...</span>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          className="w-full h-full border-0"
          style={{
            background: 'transparent',
          }}
          sandbox="allow-scripts allow-same-origin allow-forms"
          title={`Preview of ${component.displayName}`}
        />
      </div>
    </div>
  );
};

// Helper to get token options for a given path
function getTokenOptions(tokens: DesignTokens, path: string): string[] {
  const parts = path.split('.');
  let current: any = tokens;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return [];
    }
  }

  if (typeof current === 'object' && current !== null) {
    return Object.values(current).map(String);
  }
  return [String(current)];
}

export default ComponentPlayground;