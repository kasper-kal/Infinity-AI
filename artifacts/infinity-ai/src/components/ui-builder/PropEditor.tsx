/**
 * PropEditor Component
 *
 * Sidebar showing selected element's props with visual controls:
 * color picker, spacing slider, typography selector, variant selectors,
 * and Tailwind class autocomplete with design token suggestions.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Badge, Tabs, TabsList, TabsTrigger, TabsContent, Separator } from '@/components/ui';
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
  colors?: Record<string, string>;
  spacing?: Record<string, string>;
  typography?: Record<string, string>;
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

interface PropEditorProps {
  /** Currently selected element in preview */
  selectedElement?: ElementSelection | null;
  /** Design tokens from project */
  designTokens?: DesignTokens;
  /** Available components for prop suggestions */
  availableComponents?: string[];
  /** Callback when prop changed */
  onPropChange: (selector: string, propName: string, value: any) => void;
  /** Callback when structure changed (wrap, unwrap, delete, duplicate, reorder) */
  onStructureChange: (
    selector: string,
    operation: 'wrap' | 'unwrap' | 'duplicate' | 'delete' | 'move',
    options?: { wrapper?: string; targetIndex?: number }
  ) => void;
  /** Callback to extract component */
  onExtractComponent?: (selector: string, name: string) => void;
  /** Callback when element deselected */
  onDeselect?: () => void;
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
const TEXT_COLORS = ['foreground', 'muted-foreground', 'primary', 'secondary', 'destructive', 'accent'];
const BG_COLORS = ['background', 'card', 'muted', 'popover', 'primary', 'secondary', 'accent', 'destructive'];

// Helper to get design token values
function getDesignTokenValues(tokens: DesignTokens | undefined, category: keyof DesignTokens): string[] {
  if (!tokens || !tokens[category]) return [];
  return Object.entries(tokens[category] as Record<string, string>)
    .map(([key, value]) => `${key} (${value})`);
}

function getDesignTokenValue(tokens: DesignTokens | undefined, category: keyof DesignTokens, key: string): string | undefined {
  if (!tokens || !tokens[category]) return undefined;
  return (tokens[category] as Record<string, string>)[key];
}

function isValidDesignToken(tokens: DesignTokens | undefined, category: keyof DesignTokens, value: string): boolean {
  if (!tokens || !tokens[category]) return false;
  return Object.values(tokens[category] as Record<string, string>).includes(value);
}

export const PropEditor: React.FC<PropEditorProps> = ({
  selectedElement,
  designTokens,
  availableComponents = [],
  onPropChange,
  onStructureChange,
  onExtractComponent,
  onDeselect,
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
  const [extractName, setExtractName] = useState('');
  const [copiedProp, setCopiedProp] = useState<string | null>(null);

  // Parse selected element props
  useEffect(() => {
    if (!selectedElement) {
      setLocalProps({});
      return;
    }

    const parsed: Record<string, PropInfo> = {};

    // Built-in Tailwind classes from className
    const classNameParts = (selectedElement.className || '').split(/\s+/).filter(Boolean);
    const knownClasses = new Set([...COMMON_TAILWIND_CLASSES]);

    // Extract style props from className
    classNameParts.forEach(cls => {
      if (cls.startsWith('text-')) {
        parsed[`class:${cls}`] = { name: `class:${cls}`, value: cls, type: 'string', suggestions: FONT_SIZES.map(s => `text-${s}`) };
      } else if (cls.startsWith('p-') || cls.startsWith('px-') || cls.startsWith('py-') || cls.startsWith('m-') || cls.startsWith('mx-') || cls.startsWith('my-')) {
        parsed[`class:${cls}`] = { name: `class:${cls}`, value: cls, type: 'string', suggestions: SPACING_SCALE.map(s => cls.split('-')[0] + '-' + s) };
      } else if (cls.startsWith('bg-')) {
        parsed[`class:${cls}`] = { name: `class:${cls}`, value: cls, type: 'color', suggestions: BG_COLORS.map(c => `bg-${c}`) };
      } else if (cls.startsWith('text-') && TEXT_COLORS.some(c => cls.includes(c))) {
        parsed[`class:${cls}`] = { name: `class:${cls}`, value: cls, type: 'color', suggestions: TEXT_COLORS.map(c => `text-${c}`) };
      } else {
        parsed[`class:${cls}`] = { name: `class:${cls}`, value: cls, type: 'string', suggestions: COMMON_TAILWIND_CLASSES };
      }
    });

    // Other props from element
    Object.entries(selectedElement.props).forEach(([key, value]) => {
      let type: PropInfo['type'] = 'string';
      let options: string[] | undefined;

      if (typeof value === 'boolean') type = 'boolean';
      else if (typeof value === 'number') type = 'number';
      else if (typeof value === 'object') type = 'object';
      else if (key === 'variant' || key === 'size') {
        type = 'enum';
        options = getVariantOptions(selectedElement.tagName, key);
      } else if (key === 'color' || key.endsWith('Color')) {
        type = 'color';
      } else if (key.startsWith('on') && typeof value === 'string') {
        type = 'expression';
      }

      parsed[key] = { name: key, value, type, options };
    });

    setLocalProps(parsed);
  }, [selectedElement]);

  const propList = useMemo(() => Object.values(localProps), [localProps]);

  const handlePropChange = useCallback((prop: PropInfo, newValue: any) => {
    if (!selectedElement) return;

    // Update local state
    setLocalProps(prev => ({
      ...prev,
      [prop.name]: { ...prop, value: newValue },
    }));

    // Send to parent (which does AST sync)
    onPropChange(selectedElement.selector, prop.name.replace(/^class:/, ''), newValue);
  }, [selectedElement, onPropChange]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleAddProp = () => {
    if (!newPropName.trim() || !selectedElement) return;

    handlePropChange(
      { name: newPropName, value: newPropValue, type: 'string' },
      newPropValue
    );

    setNewPropName('');
    setNewPropValue('');
  };

  const handleCopyProp = async (prop: PropInfo) => {
    await navigator.clipboard.writeText(`${prop.name}="${prop.value}"`);
    setCopiedProp(prop.name);
    setTimeout(() => setCopiedProp(null), 1500);
  };

  // Categorized props
  const categorizedProps = useMemo(() => {
    const appearance: PropInfo[] = [];
    const layout: PropInfo[] = [];
    const typography: PropInfo[] = [];
    const advanced: PropInfo[] = [];

    propList.forEach(prop => {
      if (prop.name.startsWith('class:')) {
        if (prop.value.includes('text-') || prop.value.includes('font-')) typography.push(prop);
        else if (prop.value.includes('p-') || prop.value.includes('m-') || prop.value.includes('flex') || prop.value.includes('grid') || prop.value.includes('w-') || prop.value.includes('h-')) layout.push(prop);
        else appearance.push(prop);
      } else if (['variant', 'size', 'color'].includes(prop.name)) appearance.push(prop);
      else if (['className', 'style', 'id'].includes(prop.name)) advanced.push(prop);
      else if (prop.type === 'expression') advanced.push(prop);
      else appearance.push(prop);
    });

    return { appearance, layout, typography, advanced };
  }, [propList]);

  if (!selectedElement) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full p-8 text-center bg-background', className)}>
        <Square className="w-12 h-12 text-muted-foreground opacity-40 mb-3" />
        <p className="text-sm text-muted-foreground mb-1">No element selected</p>
        <p className="text-xs text-muted-foreground/70">
          Click any element in the preview to edit its props
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded font-mono">
              {selectedElement.tagName}
            </span>
            {selectedElement.parent && (
              <span className="text-xs text-muted-foreground">
                in <code className="font-mono">{selectedElement.parent}</code>
              </span>
            )}
          </div>
          {onDeselect && (
            <Button variant="ghost" size="icon" onClick={onDeselect} title="Deselect">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        <Tabs
          tabs={[
            { id: 'props', label: 'Props', content: <div /> },
            { id: 'style', label: 'Style', content: <div /> },
            { id: 'structure', label: 'Structure', content: <div /> },
          ]}
          controlledTab={activeTab}
          onChange={(tabId: "props" | "style" | "structure") => setActiveTab(tabId)}
          variant="line"
          fullWidth
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'props' && (
          <div className="space-y-4">
            {/* Appearance */}
            <PropSection
              title="Appearance"
              icon={Palette}
              expanded={expandedSections.appearance}
              onToggle={() => toggleSection('appearance')}
            >
              {categorizedProps.appearance.map(prop => (
                <PropControl
                  key={prop.name}
                  prop={prop}
                  designTokens={designTokens}
                  onPropChange={handlePropChange}
                  onCopy={handleCopyProp}
                  copied={copiedProp === prop.name}
                  enforceDesignTokens={enforceDesignTokens}
                />
              ))}
            </PropSection>

            {/* Layout */}
            <PropSection
              title="Layout"
              icon={Move}
              expanded={expandedSections.layout}
              onToggle={() => toggleSection('layout')}
            >
              {categorizedProps.layout.map(prop => (
                <PropControl
                  key={prop.name}
                  prop={prop}
                  designTokens={designTokens}
                  onPropChange={handlePropChange}
                  onCopy={handleCopyProp}
                  copied={copiedProp === prop.name}
                  enforceDesignTokens={enforceDesignTokens}
                />
              ))}
            </PropSection>

            {/* Typography */}
            <PropSection
              title="Typography"
              icon={Type}
              expanded={expandedSections.typography}
              onToggle={() => toggleSection('typography')}
            >
              {categorizedProps.typography.map(prop => (
                <PropControl
                  key={prop.name}
                  prop={prop}
                  designTokens={designTokens}
                  onPropChange={handlePropChange}
                  onCopy={handleCopyProp}
                  copied={copiedProp === prop.name}
                  enforceDesignTokens={enforceDesignTokens}
                />
              ))}
            </PropSection>

            {/* Advanced */}
            <PropSection
              title="Advanced"
              icon={ChevronDown}
              expanded={expandedSections.advanced}
              onToggle={() => toggleSection('advanced')}
            >
              {categorizedProps.advanced.map(prop => (
                <PropControl
                  key={prop.name}
                  prop={prop}
                  designTokens={designTokens}
                  onPropChange={handlePropChange}
                  onCopy={handleCopyProp}
                  copied={copiedProp === prop.name}
                  enforceDesignTokens={enforceDesignTokens}
                />
              ))}

              {/* Add custom prop */}
              <div className="mt-3 flex items-center gap-2">
                <Input
                  placeholder="propName"
                  value={newPropName}
                  onChange={e => setNewPropName(e.target.value)}
                  className="flex-1 text-xs font-mono"
                />
                <Input
                  placeholder="value"
                  value={newPropValue}
                  onChange={e => setNewPropValue(e.target.value)}
                  className="flex-1 text-xs font-mono"
                />
                <Button variant="ghost" size="icon" onClick={handleAddProp} title="Add prop">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </PropSection>
          </div>
        )}

        {activeTab === 'style' && (
          <StyleEditor
            selectedElement={selectedElement}
            designTokens={designTokens}
            onPropChange={handlePropChange}
          />
        )}

        {activeTab === 'structure' && (
          <StructureEditor
            selectedElement={selectedElement}
            availableComponents={availableComponents}
            onStructureChange={onStructureChange}
            onExtractComponent={onExtractComponent}
            extractName={extractName}
            setExtractName={setExtractName}
          />
        )}
      </div>
    </div>
  );
};

/**
 * PropSection - collapsible section
 */
const PropSection: React.FC<{
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, icon: Icon, expanded, onToggle, children }) => {
  if (React.Children.count(children) === 0) return null;

  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-sm font-medium text-foreground mb-2 hover:text-primary transition-colors"
      >
        <Icon className="w-4 h-4" />
        {title}
        {expanded ? (
          <ChevronDown className="w-4 h-4 ml-auto" />
        ) : (
          <ChevronRight className="w-4 h-4 ml-auto" />
        )}
      </button>
      {expanded && <div className="space-y-2 pl-6">{children}</div>}
    </div>
  );
};

/**
 * PropControl - individual prop editor with design token enforcement
 */
const PropControl: React.FC<{
  prop: PropInfo;
  designTokens?: DesignTokens;
  onPropChange: (prop: PropInfo, value: any) => void;
  onCopy: (prop: PropInfo) => void;
  copied: boolean;
  enforceDesignTokens?: boolean;
}> = ({ prop, designTokens, onPropChange, onCopy, copied, enforceDesignTokens }) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showTokenWarning, setShowTokenWarning] = useState(false);

  // Check if value is a valid design token
  const isTokenValue = (value: string, category: keyof DesignTokens) => {
    return isValidDesignToken(designTokens, category, value);
  };

  // Get design token suggestions for a category
  const getTokenSuggestions = (category: keyof DesignTokens) => {
    if (!designTokens || !designTokens[category]) return [];
    return Object.entries(designTokens[category] as Record<string, string>)
      .map(([key, val]) => `${key} (${val})`);
  };

  const handleValueChange = (newValue: any) => {
    // If enforcing design tokens, validate the value
    if (enforceDesignTokens && prop.isDesignToken && prop.allowedValues) {
      const isValid = prop.allowedValues.includes(newValue);
      if (!isValid && newValue !== '') {
        setShowTokenWarning(true);
        setTimeout(() => setShowTokenWarning(false), 3000);
        return; // Reject invalid value
      }
    }
    onPropChange(prop, newValue);
  };

  return (
    <div className="flex items-center gap-2">
      <code className="text-xs font-mono text-muted-foreground w-24 truncate flex-shrink-0" title={prop.name}>
        {prop.name.replace(/^class:/, '')}
        {prop.isDesignToken && enforceDesignTokens && <Lock className="w-3 h-3 ml-1 text-primary" aria-label="Design token enforced" />}
      </code>

      <div className="flex-1 min-w-0 relative">
        {prop.type === 'boolean' && (
          <Button
            variant={prop.value ? 'default' : 'outline'}
            size="sm"
            className="w-full justify-start text-xs"
            onClick={() => handleValueChange(!prop.value)}
          >
            {prop.value ? <Eye className="w-3 h-3 mr-1" /> : <EyeOff className="w-3 h-3 mr-1" />}
            {prop.value ? 'true' : 'false'}
          </Button>
        )}

        {prop.type === 'number' && (
          <Input
            type="number"
            value={prop.value}
            onChange={e => handleValueChange(Number(e.target.value))}
            className="text-xs"
          />
        )}

        {prop.type === 'enum' && (
          <Select value={prop.value} onValueChange={v => handleValueChange(v)}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder={prop.value || 'Select...'} />
            </SelectTrigger>
            <SelectContent>
              {(prop.options || []).map(opt => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {prop.type === 'color' && (
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-xs"
              onClick={() => setShowColorPicker(!showColorPicker)}
            >
              <div
                className="w-4 h-4 rounded border border-border mr-2"
                style={{
                  backgroundColor: designTokens?.colors?.[prop.value] || prop.value,
                }}
              />
              {prop.value}
            </Button>

            {showColorPicker && (
              <div className="absolute z-50 mt-1 p-2 bg-popover border border-border rounded-lg shadow-lg w-48">
                <div className="grid grid-cols-4 gap-1 mb-2">
                  {Object.entries(designTokens?.colors || {}).map(([name, value]) => (
                    <button
                      key={name}
                      className="w-8 h-8 rounded border border-border hover:scale-110 transition-transform"
                      style={{ backgroundColor: value }}
                      title={name}
                      onClick={() => {
                        handleValueChange(value);
                        setShowColorPicker(false);
                      }}
                    />
                  ))}
                </div>
                {!enforceDesignTokens && (
                  <Input
                    type="color"
                    value={typeof prop.value === 'string' && prop.value.startsWith('#') ? prop.value : '#3b82f6'}
                    onChange={e => handleValueChange(e.target.value)}
                    className="w-full h-8"
                  />
                )}
                {enforceDesignTokens && (
                  <div className="text-xs text-muted-foreground text-center py-1">
                    Custom colors disabled
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {(prop.type === 'string' || prop.type === 'expression') && (
          <div className="relative">
            <Input
              value={prop.value}
              onChange={e => handleValueChange(e.target.value)}
              className="text-xs font-mono"
              placeholder={prop.type === 'expression' ? 'expression' : 'string'}
              disabled={enforceDesignTokens && prop.isDesignToken}
            />
            {prop.suggestions && prop.suggestions.length > 0 && (
              <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {prop.suggestions.map(suggestion => (
                  <button
                    key={suggestion}
                    className="block w-full text-left px-2 py-1 text-xs font-mono hover:bg-muted"
                    onClick={() => handleValueChange(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
                {enforceDesignTokens && prop.isDesignToken && prop.allowedValues && (
                  <div className="border-t border-border p-1">
                    {prop.allowedValues.map(v => (
                      <button
                        key={v}
                        className="block w-full text-left px-2 py-1 text-xs font-mono hover:bg-muted text-primary"
                        onClick={() => handleValueChange(v)}
                      >
                        {v} (token)
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {prop.type === 'object' && (
          <div className="text-xs font-mono text-muted-foreground p-1 bg-muted rounded">
            {JSON.stringify(prop.value)}
          </div>
        )}

        {/* Design token warning */}
        {showTokenWarning && (
          <div className="absolute -top-6 left-0 right-0 flex justify-center pointer-events-none">
            <div className="flex items-center gap-1 bg-destructive/90 text-destructive-foreground text-xs px-2 py-1 rounded shadow-lg animate-slide-down">
              <AlertTriangle className="w-3 h-3" />
              <span>Value must be a design token</span>
            </div>
          </div>
        )}
      </div>

      <Button variant="ghost" size="icon" onClick={() => onCopy(prop)} title="Copy">
        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
      </Button>
    </div>
  );
};

/**
 * StyleEditor - quick style controls
 */
const StyleEditor: React.FC<{
  selectedElement: ElementSelection;
  designTokens?: DesignTokens;
  onPropChange: (prop: PropInfo, value: any) => void;
}> = ({ selectedElement, designTokens, onPropChange }) => {
  const [padding, setPadding] = useState(4);
  const [margin, setMargin] = useState(0);
  const [fontSize, setFontSize] = useState('base');
  const [radius, setRadius] = useState('lg');

  return (
    <div className="space-y-4">
      {/* Padding Slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">Padding</label>
          <span className="text-xs text-foreground">{padding * 0.25}rem</span>
        </div>
        <Slider
          value={[padding]}
          onValueChange={([v]) => {
            setPadding(v);
            onPropChange({ name: 'class:p-' + padding, value: `p-${padding}`, type: 'string' }, `p-${v}`);
          }}
          min={0}
          max={24}
          step={1}
          className="w-full"
        />
        <div className="flex gap-1 mt-1">
          {SPACING_SCALE.map(s => (
            <button
              key={s}
              className={cn(
                'flex-1 py-1 text-xs rounded border border-border',
                padding.toString() === s ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              )}
              onClick={() => {
                setPadding(Number(s));
                onPropChange({ name: 'class:p-' + padding, value: `p-${padding}`, type: 'string' }, `p-${s}`);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Font Size */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Font Size</label>
        <Select value={fontSize} onValueChange={v => {
          setFontSize(v);
          onPropChange({ name: `class:text-${fontSize}`, value: `text-${fontSize}`, type: 'string' }, `text-${v}`);
        }}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_SIZES.map(size => (
              <SelectItem key={size} value={size}>{size}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Border Radius */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Border Radius</label>
        <div className="grid grid-cols-4 gap-1">
          {['none', 'sm', 'md', 'lg'].map(r => (
            <button
              key={r}
              className={cn(
                'py-2 text-xs rounded border border-border',
                radius === r ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              )}
              onClick={() => {
                setRadius(r);
                onPropChange({ name: `class:rounded-${radius}`, value: `rounded-${radius}`, type: 'string' }, `rounded-${r}`);
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Typography Weight */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Font Weight</label>
        <div className="grid grid-cols-3 gap-1">
          {FONT_WEIGHTS.map(weight => (
            <button
              key={weight}
              className="py-1.5 text-xs rounded border border-border hover:bg-muted font-{weight}"
              onClick={() => onPropChange(
                { name: `class:font-${weight}`, value: `font-${weight}`, type: 'string' },
                `font-${weight}`
              )}
            >
              {weight}
            </button>
          ))}
        </div>
      </div>

      {/* Text Color */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Text Color</label>
        <div className="grid grid-cols-4 gap-1">
          {TEXT_COLORS.map(color => (
            <button
              key={color}
              className="py-2 text-xs rounded border border-border hover:scale-105 transition-transform"
              style={{ backgroundColor: designTokens?.colors?.[color] || '#ccc' }}
              onClick={() => onPropChange(
                { name: `class:text-${color}`, value: `text-${color}`, type: 'color' },
                `text-${color}`
              )}
            >
              <span className="sr-only">{color}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * StructureEditor - structural manipulation
 */
const StructureEditor: React.FC<{
  selectedElement: ElementSelection;
  availableComponents: string[];
  onStructureChange: (selector: string, op: 'wrap' | 'unwrap' | 'duplicate' | 'delete' | 'move', opts?: any) => void;
  onExtractComponent?: (selector: string, name: string) => void;
  extractName: string;
  setExtractName: (name: string) => void;
}> = ({ selectedElement, availableComponents, onStructureChange, onExtractComponent, extractName, setExtractName }) => {
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {selectedElement.children} child element(s)
      </div>

      <Separator />

      <div className="grid gap-2">
        <Button
          variant="outline"
          size="sm"
          className="justify-start"
          onClick={() => onStructureChange(selectedElement.selector, 'duplicate')}
        >
          <Copy className="w-4 h-4 mr-2" />
          Duplicate
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="justify-start"
          onClick={() => onStructureChange(selectedElement.selector, 'delete')}
        >
          <X className="w-4 h-4 mr-2" />
          Delete
        </Button>

        <Separator />

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Wrap with</label>
          <Select onValueChange={wrapper => onStructureChange(selectedElement.selector, 'wrap', { wrapper })}>
            <SelectTrigger>
              <SelectValue placeholder="Select wrapper" />
            </SelectTrigger>
            <SelectContent>
              {availableComponents.map(comp => (
                <SelectItem key={comp} value={comp}>{comp}</SelectItem>
              ))}
              <SelectItem value="div">div</SelectItem>
              <SelectItem value="section">section</SelectItem>
              <SelectItem value="article">article</SelectItem>
              <SelectItem value="main">main</SelectItem>
              <SelectItem value="aside">aside</SelectItem>
              <SelectItem value="header">header</SelectItem>
              <SelectItem value="footer">footer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="justify-start"
          onClick={() => onStructureChange(selectedElement.selector, 'unwrap')}
        >
          <Move className="w-4 h-4 mr-2" />
          Unwrap
        </Button>

        <Separator />

        {onExtractComponent && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Extract as Component</label>
            <div className="flex gap-2">
              <Input
                placeholder="ComponentName"
                value={extractName}
                onChange={e => setExtractName(e.target.value)}
                className="text-xs font-mono"
              />
              <Button
                size="sm"
                disabled={!extractName.trim()}
                onClick={() => onExtractComponent(selectedElement.selector, extractName)}
              >
                Extract
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Get variant options for a component
 */
function getVariantOptions(tagName: string, propName: string): string[] {
  const variantMap: Record<string, Record<string, string[]>> = {
    Button: { variant: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'], size: ['sm', 'default', 'lg', 'icon'] },
    Input: { type: ['text', 'email', 'password', 'number', 'search', 'tel', 'url'] },
    Badge: { variant: ['default', 'secondary', 'destructive', 'outline'] },
    Alert: { variant: ['default', 'destructive'] },
    Card: { variant: ['default', 'header', 'content', 'footer'] },
    Select: { variant: ['default', 'outline'] },
  };

  return variantMap[tagName]?.[propName] || [];
}

export default PropEditor;