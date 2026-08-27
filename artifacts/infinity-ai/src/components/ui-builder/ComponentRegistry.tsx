/**
 * ComponentRegistry Component
 *
 * Project-scoped shadcn/ui + custom components with design token sync,
 * composition suggestions, and search.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge, Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui';
import { Search, Plus, Copy, Check, Palette, Box, FileCode } from 'lucide-react';

interface ComponentInfo {
  name: string;
  category: 'form' | 'layout' | 'navigation' | 'data-display' | 'feedback' | 'overlay' | 'advanced' | 'typography';
  imports: string[];
  variants?: string[];
  description?: string;
  usage?: string;
  shadcn: boolean;
}

interface DesignTokens {
  colors?: Record<string, string>;
  spacing?: Record<string, string>;
  typography?: Record<string, string>;
  borderRadius?: Record<string, string>;
  shadows?: Record<string, string>;
}

interface ComponentRegistryProps {
  /** Project ID for scoped components */
  projectId?: string;
  /** Framework */
  framework?: 'nextjs' | 'vite' | 'astro' | 'remix';
  /** Design tokens from project */
  designTokens?: DesignTokens;
  /** Custom components from project */
  customComponents?: ComponentInfo[];
  /** Callback when component selected for insertion */
  onSelectComponent?: (component: ComponentInfo) => void;
  /** Callback when token changed */
  onTokenChange?: (tokens: DesignTokens) => void;
  className?: string;
}

// Default shadcn/ui components
const SHADCN_COMPONENTS: ComponentInfo[] = [
  // Form
  { name: 'button', category: 'form', imports: ['@/components/ui/button'], variants: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'], description: 'Clickable button with multiple variants', shadcn: true },
  { name: 'input', category: 'form', imports: ['@/components/ui/input'], description: 'Text input field', shadcn: true },
  { name: 'textarea', category: 'form', imports: ['@/components/ui/textarea'], description: 'Multi-line text input', shadcn: true },
  { name: 'select', category: 'form', imports: ['@/components/ui/select'], description: 'Dropdown select', shadcn: true },
  { name: 'checkbox', category: 'form', imports: ['@/components/ui/checkbox'], description: 'Checkbox input', shadcn: true },
  { name: 'radio-group', category: 'form', imports: ['@/components/ui/radio-group'], description: 'Radio button group', shadcn: true },
  { name: 'switch', category: 'form', imports: ['@/components/ui/switch'], description: 'Toggle switch', shadcn: true },
  { name: 'slider', category: 'form', imports: ['@/components/ui/slider'], description: 'Range slider', shadcn: true },
  { name: 'form', category: 'form', imports: ['@/components/ui/form'], description: 'Form wrapper with validation', shadcn: true },
  { name: 'label', category: 'form', imports: ['@/components/ui/label'], description: 'Form label', shadcn: true },

  // Layout
  { name: 'card', category: 'layout', imports: ['@/components/ui/card'], variants: ['default', 'header', 'content', 'footer'], description: 'Card container', shadcn: true },
  { name: 'separator', category: 'layout', imports: ['@/components/ui/separator'], description: 'Visual separator', shadcn: true },
  { name: 'aspect-ratio', category: 'layout', imports: ['@/components/ui/aspect-ratio'], description: 'Aspect ratio container', shadcn: true },
  { name: 'container', category: 'layout', imports: ['@/components/ui/container'], description: 'Centered container', shadcn: true },

  // Navigation
  { name: 'navigation-menu', category: 'navigation', imports: ['@/components/ui/navigation-menu'], description: 'Navigation menu', shadcn: true },
  { name: 'breadcrumb', category: 'navigation', imports: ['@/components/ui/breadcrumb'], description: 'Breadcrumb trail', shadcn: true },
  { name: 'pagination', category: 'navigation', imports: ['@/components/ui/pagination'], description: 'Pagination controls', shadcn: true },
  { name: 'tabs', category: 'navigation', imports: ['@/components/ui/tabs'], description: 'Tabbed interface', shadcn: true },
  { name: 'sidebar', category: 'navigation', imports: ['@/components/ui/sidebar'], description: 'Sidebar navigation', shadcn: true },

  // Data Display
  { name: 'table', category: 'data-display', imports: ['@/components/ui/table'], description: 'Data table', shadcn: true },
  { name: 'badge', category: 'data-display', imports: ['@/components/ui/badge'], variants: ['default', 'secondary', 'destructive', 'outline'], description: 'Status badge', shadcn: true },
  { name: 'avatar', category: 'data-display', imports: ['@/components/ui/avatar'], description: 'User avatar', shadcn: true },
  { name: 'progress', category: 'data-display', imports: ['@/components/ui/progress'], description: 'Progress bar', shadcn: true },
  { name: 'skeleton', category: 'data-display', imports: ['@/components/ui/skeleton'], description: 'Loading skeleton', shadcn: true },
  { name: 'tooltip', category: 'data-display', imports: ['@/components/ui/tooltip'], description: 'Hover tooltip', shadcn: true },
  { name: 'popover', category: 'data-display', imports: ['@/components/ui/popover'], description: 'Popover panel', shadcn: true },
  { name: 'hover-card', category: 'data-display', imports: ['@/components/ui/hover-card'], description: 'Hover card', shadcn: true },

  // Feedback
  { name: 'alert', category: 'feedback', imports: ['@/components/ui/alert'], variants: ['default', 'destructive'], description: 'Alert message', shadcn: true },
  { name: 'alert-dialog', category: 'feedback', imports: ['@/components/ui/alert-dialog'], description: 'Confirmation dialog', shadcn: true },
  { name: 'dialog', category: 'feedback', imports: ['@/components/ui/dialog'], description: 'Modal dialog', shadcn: true },
  { name: 'drawer', category: 'feedback', imports: ['@/components/ui/drawer'], description: 'Bottom sheet drawer', shadcn: true },
  { name: 'sheet', category: 'feedback', imports: ['@/components/ui/sheet'], description: 'Side sheet', shadcn: true },
  { name: 'toast', category: 'feedback', imports: ['@/components/ui/toast'], description: 'Toast notification', shadcn: true },
  { name: 'sonner', category: 'feedback', imports: ['sonner'], description: 'Toast library', shadcn: true },

  // Overlay
  { name: 'dropdown-menu', category: 'overlay', imports: ['@/components/ui/dropdown-menu'], description: 'Dropdown menu', shadcn: true },
  { name: 'context-menu', category: 'overlay', imports: ['@/components/ui/context-menu'], description: 'Context menu', shadcn: true },
  { name: 'menubar', category: 'overlay', imports: ['@/components/ui/menubar'], description: 'Menu bar', shadcn: true },
  { name: 'combobox', category: 'overlay', imports: ['@/components/ui/combobox'], description: 'Searchable select', shadcn: true },
  { name: 'command', category: 'overlay', imports: ['@/components/ui/command'], description: 'Command palette', shadcn: true },

  // Advanced
  { name: 'accordion', category: 'advanced', imports: ['@/components/ui/accordion'], description: 'Collapsible accordion', shadcn: true },
  { name: 'collapsible', category: 'advanced', imports: ['@/components/ui/collapsible'], description: 'Collapsible panel', shadcn: true },
  { name: 'resizable', category: 'advanced', imports: ['@/components/ui/resizable'], description: 'Resizable panels', shadcn: true },
  { name: 'scroll-area', category: 'advanced', imports: ['@/components/ui/scroll-area'], description: 'Custom scroll area', shadcn: true },
  { name: 'carousel', category: 'advanced', imports: ['@/components/ui/carousel'], description: 'Image carousel', shadcn: true },
  { name: 'calendar', category: 'advanced', imports: ['@/components/ui/calendar'], description: 'Date calendar', shadcn: true },
  { name: 'date-picker', category: 'advanced', imports: ['@/components/ui/date-picker'], description: 'Date picker', shadcn: true },

  // Typography
  { name: 'typography', category: 'typography', imports: ['@/components/ui/typography'], description: 'Typography styles', shadcn: true },
];

const CATEGORY_LABELS: Record<ComponentInfo['category'], string> = {
  form: 'Form',
  layout: 'Layout',
  navigation: 'Navigation',
  'data-display': 'Data Display',
  feedback: 'Feedback',
  overlay: 'Overlay',
  advanced: 'Advanced',
  typography: 'Typography',
};

const CATEGORY_ICONS: Record<ComponentInfo['category'], React.ComponentType> = {
  form: Box,
  layout: Box,
  navigation: Box,
  'data-display': Box,
  feedback: Box,
  overlay: Box,
  advanced: Box,
  typography: Box,
};

export const ComponentRegistry: React.FC<ComponentRegistryProps> = ({
  projectId,
  framework = 'nextjs',
  designTokens,
  customComponents = [],
  onSelectComponent,
  onTokenChange,
  className,
}) => {
  const [search, setSearch] = useState('');
  const [copiedComponent, setCopiedComponent] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'components' | 'tokens'>('components');

  // Combine shadcn + custom components
  const allComponents = useMemo(() => {
    const existingNames = new Set(SHADCN_COMPONENTS.map(c => c.name));
    const customFiltered = customComponents.filter(c => !existingNames.has(c.name));
    return [...SHADCN_COMPONENTS, ...customFiltered];
  }, [customComponents]);

  // Filter by search
  const filteredComponents = useMemo(() => {
    if (!search) return allComponents;
    const lower = search.toLowerCase();
    return allComponents.filter(c =>
      c.name.toLowerCase().includes(lower) ||
      c.description?.toLowerCase().includes(lower) ||
      c.category.toLowerCase().includes(lower)
    );
  }, [allComponents, search]);

  // Group by category
  const groupedComponents = useMemo(() => {
    const groups: Record<string, ComponentInfo[]> = {};
    filteredComponents.forEach(c => {
      if (!groups[c.category]) groups[c.category] = [];
      groups[c.category].push(c);
    });
    return groups;
  }, [filteredComponents]);

  const handleCopyImport = useCallback(async (component: ComponentInfo) => {
    const importStatement = `import { ${component.name} } from '${component.imports[0]}';`;
    await navigator.clipboard.writeText(importStatement);
    setCopiedComponent(component.name);
    setTimeout(() => setCopiedComponent(null), 1500);
  }, []);

  const handleSelect = useCallback((component: ComponentInfo) => {
    onSelectComponent?.(component);
  }, [onSelectComponent]);

  const tokenCategories: Record<string, keyof DesignTokens> = {
    Colors: 'colors',
    Spacing: 'spacing',
    Typography: 'typography',
    Radius: 'borderRadius',
    Shadows: 'shadows',
  };

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Header */}
      <div className="p-3 border-b border-border">
        <Tabs value={activeSection} onValueChange={setActiveSection}>
          <TabsList className="w-full">
            <TabsTrigger value="components" className="flex-1">
              <Box className="w-4 h-4 mr-2" />
              Components
            </TabsTrigger>
            <TabsTrigger value="tokens" className="flex-1">
              <Palette className="w-4 h-4 mr-2" />
              Design Tokens
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {activeSection === 'components' ? (
        <>
          {/* Search */}
          <div className="p-3 border-b border-border">
            <Input
              placeholder="Search components..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              icon={<Search className="w-4 h-4" />}
            />
          </div>

          {/* Components list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {Object.entries(groupedComponents).map(([category, comps]) => {
              const IconComponent = CATEGORY_ICONS[category as ComponentInfo['category']];
              return (
              <div key={category}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                  <IconComponent className="w-3.5 h-3.5" />
                  {CATEGORY_LABELS[category as ComponentInfo['category']]}
                  <Badge variant="secondary" className="text-xs">{comps.length}</Badge>
                </h3>

                <div className="grid gap-2">
                  {comps.map(component => (
                    <div
                      key={component.name}
                      className="group flex items-center justify-between p-2 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => handleSelect(component)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-mono text-foreground">{component.name}</code>
                          {!component.shadcn && (
                            <Badge variant="outline" className="text-xs">Custom</Badge>
                          )}
                          {component.variants && (
                            <Badge variant="secondary" className="text-xs">{component.variants.length} variants</Badge>
                          )}
                        </div>
                        {component.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{component.description}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); handleCopyImport(component); }}
                          title="Copy import"
                        >
                          {copiedComponent === component.name ? (
                            <Check className="w-3.5 h-3.5 text-green-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); handleSelect(component); }}
                          title="Insert"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

            {Object.keys(groupedComponents).length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Box className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No components found for "{search}"</p>
              </div>
            )}

            {customComponents.length > 0 && (
              <div className="pt-4 border-t border-border">
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                  <FileCode className="w-3.5 h-3.5" />
                  Custom Components
                  <Badge variant="secondary" className="text-xs">{customComponents.length}</Badge>
                </h3>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Design Tokens */
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {Object.entries(tokenCategories).map(([label, key]) => {
            const tokens = designTokens?.[key] || {};
            const tokenEntries = Object.entries(tokens);

            return (
              <div key={key}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                  <Palette className="w-3.5 h-3.5" />
                  {label}
                  <Badge variant="secondary" className="text-xs">{tokenEntries.length}</Badge>
                </h3>

                {tokenEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-2 border border-dashed border-border rounded">
                    No {label.toLowerCase()} defined yet
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {tokenEntries.map(([name, value]) => (
                      <div
                        key={name}
                        className="flex items-center justify-between p-2 rounded-lg border border-border"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded border border-border"
                            style={{
                              backgroundColor: key === 'colors' ? value : undefined,
                              backgroundImage: key === 'colors' ? undefined : `repeating-linear-gradient(45deg, ${value}, ${value} 2px, transparent 2px, transparent 4px)`,
                            }}
                          />
                          <div>
                            <code className="text-sm font-mono">{name}</code>
                            <p className="text-xs text-muted-foreground">{value}</p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigator.clipboard.writeText(value)}
                          title="Copy value"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {onTokenChange && (
            <Button variant="outline" className="w-full" onClick={() => onTokenChange(designTokens || {})}>
              <Plus className="w-4 h-4 mr-2" />
              Add Token
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default ComponentRegistry;