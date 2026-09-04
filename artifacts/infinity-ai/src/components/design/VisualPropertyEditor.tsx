/**
 * VisualPropertyEditor Component
 *
 * Sidebar showing selected element's props with visual controls:
 * color picker, spacing slider, typography selector, variant selectors,
 * and Tailwind class autocomplete with design token suggestions.
 * Adapted from PropEditor for Design Mode.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button, IconButton, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Badge, Tabs, TabsList, TabsTrigger, TabsContent, Separator, ScrollArea } from '@/components/ui';
import {
  Palette,
  Type,
  Square,
  Move,
  Eye,
  EyeOff,
  RotateCcw,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  AlertTriangle,
  Lock,
  SlidersHorizontal,
  Code,
} from 'lucide-react';

interface PropInfo {
  name: string;
  value: any;
  type: 'string' | 'number' | 'boolean' | 'color' | 'enum' | 'object' | 'expression';
  options?: string[];
  suggestions?: string[];
  // Design token enforcement
  isDesignToken?: boolean;
  allowedValues?: string[];
}

interface DesignTokens {
  colors?: Record<string, Record<string, string>>;
  spacing?: Record<string, string>;
  typography?: Record<string, Record<string, string>>;
  borderRadius?: Record<string, string>;
  shadows?: Record<string, string>;
}

interface ElementSelection {
  selector: string;
  tagName: string;
  props: Record<string, any>;
  className: string;
  children: number;
  parent?: string;
}

interface VisualPropertyEditorProps {
  /** Currently selected element in preview */
  element?: ElementSelection | null;
  /** Design tokens from project */
  designTokens?: DesignTokens;
  /** Available components for prop suggestions */
  availableComponents?: string[];
  /** Callback when prop changed */
  onChange?: (selector: string, propName: string, value: any) => void;
  /** Enforce design tokens only (no custom values) */
  enforceDesignTokens?: boolean;
  className?: string;
}

const COMMON_TAILWIND_CLASSES = [
  'p-4', 'px-4', 'py-2', 'm-4', 'mx-auto', 'text-center', 'flex', 'grid',
  'rounded-lg', 'border', 'shadow-md', 'hover:bg-muted', 'transition-colors',
  'w-full', 'max-w-md', 'space-y-4', 'gap-2', 'items-center', 'justify-between',
];

const SPACING_SCALE = ['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24'];
const FONT_SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'];
const FONT_WEIGHTS = ['thin', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold'];

// Helper to get design token values
function getDesignTokenValues(tokens: DesignTokens | undefined, category: keyof DesignTokens): string[] {
  if (!tokens || !tokens[category]) return [];
  const cat = tokens[category] as Record<string, Record<string, string> | string>;
  const result: string[] = [];
  for (const [key, value] of Object.entries(cat)) {
    if (typeof value === 'object' && value !== null) {
      for (const [subKey, subValue] of Object.entries(value)) {
        result.push(`${key}.${subKey} (${subValue})`);
      }
    } else {
      result.push(`${key} (${value})`);
    }
  }
  return result;
}

function getDesignTokenValue(tokens: DesignTokens | undefined, category: keyof DesignTokens, key: string): string | undefined {
  if (!tokens || !tokens[category]) return undefined;
  return (tokens[category] as Record<string, string>)[key];
}

function isValidDesignToken(tokens: DesignTokens | undefined, category: keyof DesignTokens, value: string): boolean {
  if (!tokens || !tokens[category]) return false;
  const cat = tokens[category] as Record<string, Record<string, string> | string>;
  for (const value of Object.values(cat)) {
    if (typeof value === 'object' && value !== null) {
      if (Object.values(value).includes(value)) return true;
    } else if (value === value) return true;
  }
  return false;
}

function getVariantOptions(tagName: string, key: string): string[] {
  if (key === 'variant') {
    return ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'];
  }
  if (key === 'size') {
    return ['default', 'sm', 'lg', 'xl', 'icon'];
  }
  return [];
}

export const VisualPropertyEditor: React.FC<VisualPropertyEditorProps> = ({
  element,
  designTokens,
  availableComponents = [],
  onChange,
  enforceDesignTokens = true,
  className,
}) => {
  const [activeTab, setActiveTab] = useState<'props' | 'style' | 'structure'>('props');
  const [localProps, setLocalProps] = useState<Record<string, PropInfo>>({});
  const [newPropName, setNewPropName] = useState('');
  const [newPropValue, setNewPropValue] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    appearance: true,
    layout: true,
    typography: true,
    advanced: false,
  });
  const [copiedProp, setCopiedProp] = useState<string | null>(null);

  // Parse selected element props
  useEffect(() => {
    if (!element) {
      setLocalProps({});
      return;
    }

    const parsed: Record<string, PropInfo> = {};

    // Built-in Tailwind classes from className
    const classNameParts = (element.className || '').split(/\s+/).filter(Boolean);

    // Extract style props from className
    classNameParts.forEach(cls => {
      if (cls.startsWith('text-') && !cls.startsWith('text-[')) {
        parsed[`class:${cls}`] = {
          name: `class:${cls}`,
          value: cls,
          type: 'string',
          suggestions: FONT_SIZES.map(s => `text-${s}`),
        };
      } else if (cls.startsWith('p-') || cls.startsWith('px-') || cls.startsWith('py-') ||
                 cls.startsWith('m-') || cls.startsWith('mx-') || cls.startsWith('my-')) {
        parsed[`class:${cls}`] = {
          name: `class:${cls}`,
          value: cls,
          type: 'string',
          suggestions: SPACING_SCALE.map(s => cls.split('-')[0] + '-' + s),
        };
      } else if (cls.startsWith('bg-')) {
        parsed[`class:${cls}`] = {
          name: `class:${cls}`,
          value: cls,
          type: 'color',
          suggestions: ['bg-background', 'bg-card', 'bg-muted', 'bg-popover', 'bg-primary', 'bg-secondary', 'bg-accent', 'bg-destructive'],
        };
      } else if (cls.startsWith('text-')) {
        parsed[`class:${cls}`] = {
          name: `class:${cls}`,
          value: cls,
          type: 'color',
          suggestions: ['text-foreground', 'text-muted-foreground', 'text-primary', 'text-secondary', 'text-destructive', 'text-accent'],
        };
      } else {
        parsed[`class:${cls}`] = {
          name: `class:${cls}`,
          value: cls,
          type: 'string',
          suggestions: COMMON_TAILWIND_CLASSES,
        };
      }
    });

    // Other props from element
    Object.entries(element.props).forEach(([key, value]) => {
      let type: PropInfo['type'] = 'string';
      let options: string[] | undefined;

      if (typeof value === 'boolean') type = 'boolean';
      else if (typeof value === 'number') type = 'number';
      else if (typeof value === 'object') type = 'object';
      else if (key === 'variant' || key === 'size') {
        type = 'enum';
        options = getVariantOptions(element.tagName, key);
      } else if (key === 'color' || key.endsWith('Color')) {
        type = 'color';
      } else if (key.startsWith('on') && typeof value === 'string') {
        type = 'expression';
      }

      parsed[key] = { name: key, value, type, options };
    });

    setLocalProps(parsed);
  }, [element]);

  const propList = useMemo(() => Object.values(localProps), [localProps]);

  const handlePropChange = useCallback((prop: PropInfo, newValue: any) => {
    if (!element || !onChange) return;

    // Update local state
    setLocalProps(prev => ({
      ...prev,
      [prop.name]: { ...prop, value: newValue },
    }));

    // Call onChange callback
    onChange(element.selector, prop.name, newValue);
  }, [element, onChange]);

  const handleCopyProp = useCallback((propName: string, value: string) => {
    navigator.clipboard.writeText(`${propName}: "${value}"`);
    setCopiedProp(propName);
    setTimeout(() => setCopiedProp(null), 2000);
  }, []);

  const handleAddCustomProp = useCallback(() => {
    if (!newPropName.trim() || !element) return;
    setLocalProps(prev => ({
      ...prev,
      [newPropName]: { name: newPropName, value: newPropValue, type: 'string' },
    }));
    onChange?.(element.selector, newPropName, newPropValue);
    setNewPropName('');
    setNewPropValue('');
  }, [element, newPropName, newPropValue, onChange]);

  const handleDeleteProp = useCallback((propName: string) => {
    if (!element) return;
    setLocalProps(prev => {
      const next = { ...prev };
      delete next[propName];
      return next;
    });
    onChange?.(element.selector, propName, undefined);
  }, [element, onChange]);

  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  if (!element) {
    return (
      <div className={cn('visual-property-editor empty', className)}>
        <div className="sidebar-header">
          <h3>Properties</h3>
        </div>
        <div className="sidebar-empty-state">
          <MousePointer className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-center text-muted-foreground">
            Select an element to edit properties
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('visual-property-editor', className)}>
      <div className="sidebar-header flex items-center justify-between">
        <div className="header-left flex items-center gap-2">
          <h3>Properties</h3>
          <Badge variant="outline" className="element-type-badge">
              {element.tagName.toLowerCase()}
            </Badge>
        </div>
      </div>

      <Separator />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4">
        <TabsList>
          <TabsTrigger value="props">
            <SlidersHorizontal className="w-4 h-4 mr-1" />
            Props
          </TabsTrigger>
          <TabsTrigger value="style">
            <Palette className="w-4 h-4 mr-1" />
            Style
          </TabsTrigger>
          <TabsTrigger value="structure">
            <Move className="w-4 h-4 mr-1" />
            Structure
          </TabsTrigger>
        </TabsList>

        {/* Props Tab */}
        <TabsContent value="props" className="pt-4">
          <ScrollArea className="max-h-[calc(100vh-300px)]">
            <div className="space-y-4">
              {/* Custom prop adder */}
              <div className="flex gap-2 p-3 bg-muted/50 rounded-lg">
                <Input
                  placeholder="Property name"
                  value={newPropName}
                  onChange={e => setNewPropName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCustomProp()}
                  className="flex-1"
                />
                <Input
                  placeholder="Value"
                  value={newPropValue}
                  onChange={e => setNewPropValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCustomProp()}
                  className="flex-1"
                />
                <Button size="sm" onClick={handleAddCustomProp} disabled={!newPropName.trim()}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {/* Props list grouped by category */}
              {renderPropSection('appearance', 'Appearance', [
                'variant', 'size', 'color', 'disabled', 'loading',
              ])}
              {renderPropSection('layout', 'Layout', [
                'class:', 'width', 'height', 'display', 'flex', 'grid', 'gap', 'padding', 'margin',
              ])}
              {renderPropSection('typography', 'Typography', [
                'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'fontFamily',
              ])}
              {renderPropSection('advanced', 'Advanced', [
                'id', 'data-testid', 'data-preview-id', 'ref', 'key',
              ])}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Style Tab */}
        <TabsContent value="style" className="pt-4">
          <ScrollArea className="max-h-[calc(100vh-300px)]">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">CSS Custom Properties</label>
                <div className="space-y-2">
                  {Object.entries(designTokens?.colors || {}).map(([palette, shades]) => (
                    <div key={palette} className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground capitalize">{palette}</label>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(shades).map(([shade, value]) => (
                          <button
                            key={shade}
                            onClick={() => handlePropChange(
                              { name: `--color-${palette}-${shade}`, value, type: 'color' },
                              value
                            )}
                            className="w-8 h-8 rounded border-2 transition-all hover:scale-110"
                            style={{ backgroundColor: value, borderColor: value }}
                            title={`${palette}-${shade}: ${value}`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div>
                <label className="block text-sm font-medium mb-2">Spacing Scale</label>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(designTokens?.spacing || {}).map(([key, value]) => (
                    <button
                      key={key}
                      onClick={() => handlePropChange(
                        { name: `spacing-${key}`, value, type: 'spacing' },
                        value
                      )}
                      className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted-foreground/10 transition-colors"
                    >
                      {key} ({value})
                    </button>
                  ))}
                </div>
              </div>

              <Separator />

              <div>
                <label className="block text-sm font-medium mb-2">Typography Scale</label>
                <div className="space-y-1">
                  {Object.entries(designTokens?.typography?.fontSize || {}).map(([key, value]) => (
                    <button
                      key={key}
                      onClick={() => handlePropChange(
                        { name: `font-size-${key}`, value, type: 'typography' },
                        value
                      )}
                      className="w-full text-left px-2 py-1 text-xs rounded bg-muted hover:bg-muted-foreground/10 transition-colors"
                    >
                      {key}: {value}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Structure Tab */}
        <TabsContent value="structure" className="pt-4">
          <ScrollArea className="max-h-[calc(100vh-300px)]">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Element Structure</label>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Tag</span>
                    <code className="bg-muted px-2 py-1 rounded font-mono">{element.tagName.toLowerCase()}</code>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Selector</span>
                    <code className="bg-muted px-2 py-1 rounded font-mono truncate max-w-[150px]">{element.selector}</code>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Children</span>
                    <span>{element.children}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Depth</span>
                    <span>{element.parent ? 'Nested' : 'Root'}</span>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <label className="block text-sm font-medium mb-2">Actions</label>
                <div className="space-y-2 grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => onChange?.(element.selector, 'wrap', 'div')}>
                    <Square className="w-4 h-4 mr-1" />
                    Wrap
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onChange?.(element.selector, 'unwrap', undefined)}>
                    <RotateCcw className="w-4 h-4 mr-1" />
                    Unwrap
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onChange?.(element.selector, 'duplicate', undefined)}>
                    <Plus className="w-4 h-4 mr-1" />
                    Duplicate
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => onChange?.(element.selector, 'delete', undefined)}>
                    <X className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );

  function renderPropSection(sectionKey: string, label: string, filterKeys: string[]) {
    const sectionProps = propList.filter(p =>
      filterKeys.some(k => p.name.toLowerCase().includes(k.toLowerCase()))
    );

    if (sectionProps.length === 0) return null;

    return (
      <div key={sectionKey} className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-muted-foreground capitalize flex items-center gap-1">
            <ChevronRight
              className={cn('w-3 h-3 transition-transform', expandedSections[sectionKey] ? 'rotate-90' : '')}
            />
            {label} ({sectionProps.length})
          </h4>
          <IconButton
            variant="ghost"
            size="sm"
            onClick={() => toggleSection(sectionKey)}
            className="opacity-50 hover:opacity-100"
          >
            {expandedSections[sectionKey] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </IconButton>
        </div>

        {expandedSections[sectionKey] && (
          <div className="space-y-2 ml-4 border-l-2 border-border-primary/30 pl-3">
            {sectionProps.map(prop => (
              <PropRow
                key={prop.name}
                prop={prop}
                onChange={handlePropChange}
                onCopy={() => handleCopyProp(prop.name, String(prop.value))}
                onDelete={() => handleDeleteProp(prop.name)}
                copied={copiedProp === prop.name}
                designTokens={designTokens}
                enforceDesignTokens={enforceDesignTokens}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
};

// Prop Row Component
interface PropRowProps {
  prop: PropInfo;
  onChange: (prop: PropInfo, value: any) => void;
  onCopy: () => void;
  onDelete: () => void;
  copied: boolean;
  designTokens?: DesignTokens;
  enforceDesignTokens?: boolean;
}

const PropRow: React.FC<PropRowProps> = ({
  prop,
  onChange,
  onCopy,
  onDelete,
  copied,
  designTokens,
  enforceDesignTokens,
}) => {
  const [showSuggestions, setShowSuggestions] = useState(false);

  const renderInput = () => {
    switch (prop.type) {
      case 'boolean':
        return (
          <input
            type="checkbox"
            checked={prop.value}
            onChange={e => onChange(prop, e.target.checked)}
            className="w-4 h-4 rounded border-border-primary bg-background"
          />
        );

      case 'number':
        return (
          <input
            type="number"
            value={prop.value}
            onChange={e => onChange(prop, Number(e.target.value))}
            className="w-24 px-2 py-1 text-sm border border-border-primary rounded bg-background"
          />
        );

      case 'color':
        return (
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={prop.value?.startsWith('#') ? prop.value : '#000000'}
              onChange={e => onChange(prop, e.target.value)}
              className="w-8 h-8 rounded border border-border-primary cursor-pointer"
            />
            <input
              type="text"
              value={prop.value}
              onChange={e => onChange(prop, e.target.value)}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              className="flex-1 px-2 py-1 text-sm border border-border-primary rounded bg-background"
              list={prop.suggestions?.length ? `suggestions-${prop.name}` : undefined}
            />
            {prop.suggestions && showSuggestions && (
              <datalist id={`suggestions-${prop.name}`}>
                {prop.suggestions.map(s => <option key={s} value={s} />)}
              </datalist>
            )}
          </div>
        );

      case 'enum':
        return (
          <Select
            value={String(prop.value)}
            onValueChange={value => onChange(prop, value)}
            className="w-full"
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {prop.options?.map(opt => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'expression':
        return (
          <Input
            value={prop.value}
            onChange={e => onChange(prop, e.target.value)}
            placeholder="Event handler..."
            className="font-mono text-sm"
          />
        );

      default:
        return (
          <div className="flex-1">
            <Input
              value={String(prop.value)}
              onChange={e => onChange(prop, e.target.value)}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              className="font-mono text-sm"
              list={prop.suggestions?.length ? `suggestions-${prop.name}` : undefined}
            />
            {prop.suggestions && showSuggestions && (
              <datalist id={`suggestions-${prop.name}`}>
                {prop.suggestions.map(s => <option key={s} value={s} />)}
              </datalist>
            )}
          </div>
        );
    }
  };

  return (
    <div className="flex items-center gap-2 py-1">
      <div className="w-32 flex-shrink-0">
        <label className="text-xs font-medium text-muted-foreground truncate pr-2">
          {prop.name}
        </label>
      </div>
      <div className="flex-1 min-w-0">
        {renderInput()}
      </div>
      <div className="flex items-center gap-1">
        <IconButton
          variant="ghost"
          size="sm"
          onClick={onCopy}
          className={copied ? 'text-green-500' : 'opacity-50'}
          title="Copy"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </IconButton>
        <IconButton
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="opacity-50 hover:opacity-100 text-red-500"
          title="Delete"
        >
          <X className="w-3 h-3" />
        </IconButton>
      </div>
    </div>
  );
};

import { MousePointer } from 'lucide-react';

export default VisualPropertyEditor;