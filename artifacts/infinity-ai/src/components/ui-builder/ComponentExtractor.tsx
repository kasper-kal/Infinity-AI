/**
 * ComponentExtractor Component
 *
 * Enables selecting multiple elements → "Extract as Component" →
 * creates new reusable component file with proper imports and prop interface.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge, Tabs, TabsList, TabsTrigger, TabsContent, Separator } from '@/components/ui';
import { Plus } from 'lucide-react';
import {
  FileCode,
  Plus,
  X,
  Check,
  Copy,
  Download,
  Box,
  Eye,
} from 'lucide-react';

interface ExtractedElement {
  selector: string;
  tagName: string;
  className: string;
  props: Record<string, any>;
  code: string;
  depth: number;
}

interface ComponentExtractorProps {
  /** Elements to extract (from visual selection) */
  selectedElements: ExtractedElement[];
  /** Available component names in project */
  availableComponents?: string[];
  /** Callback when component extracted */
  onExtract: (componentName: string, code: string, options?: { exportFile: string }) => void;
  /** Callback to close extractor */
  onClose?: () => void;
  className?: string;
}

interface ExtractOptions {
  componentName: string;
  exportLocation: string;
  addPropsInterface: boolean;
  generateStory: boolean;
  includeStyles: boolean;
}

const DEFAULT_EXPORT_LOCATION = '@/components/ui';

export const ComponentExtractor: React.FC<ComponentExtractorProps> = ({
  selectedElements,
  availableComponents = [],
  onExtract,
  onClose,
  className,
}) => {
  const [componentName, setComponentName] = useState('');
  const [exportLocation, setExportLocation] = useState(DEFAULT_EXPORT_LOCATION);
  const [addPropsInterface, setAddPropsInterface] = useState(true);
  const [generateStory, setGenerateStory] = useState(false);
  const [includeStyles, setIncludeStyles] = useState(true);
  const [previewCode, setPreviewCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [extracting, setExtracting] = useState(false);

  // Auto-generate component name from first element
  useEffect(() => {
    if (selectedElements.length > 0 && !componentName) {
      const first = selectedElements[0];
      const base = first.tagName.charAt(0).toUpperCase() + first.tagName.slice(1);
      setComponentName(`${base}Component`);
    }
  }, [selectedElements, componentName]);

  // Generate preview code
  useEffect(() => {
    if (selectedElements.length === 0) return;

    const code = generateComponentCode(
      componentName || 'NewComponent',
      selectedElements,
      { addPropsInterface, generateStory, includeStyles, exportLocation }
    );
    setPreviewCode(code);
  }, [componentName, selectedElements, addPropsInterface, generateStory, includeStyles, exportLocation]);

  const handleExtract = useCallback(() => {
    if (!componentName.trim() || selectedElements.length === 0) return;

    setExtracting(true);

    const code = generateComponentCode(
      componentName,
      selectedElements,
      { addPropsInterface, generateStory, includeStyles, exportLocation }
    );

    onExtract(componentName, code, { exportFile: `${exportLocation}/${componentName.toLowerCase()}` });

    setTimeout(() => {
      setExtracting(false);
      onClose?.();
    }, 500);
  }, [componentName, selectedElements, addPropsInterface, generateStory, includeStyles, exportLocation, onExtract, onClose]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(previewCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [previewCode]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([previewCode], { type: 'text/typescript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${componentName || 'component'}.tsx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [previewCode, componentName]);

  if (selectedElements.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full p-8 text-center bg-background', className)}>
        <FileCode className="w-12 h-12 text-muted-foreground opacity-40 mb-3" />
        <p className="text-sm text-muted-foreground mb-1">No elements selected</p>
        <p className="text-xs text-muted-foreground/70">
          Select elements in the preview to extract them as a component
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Box className="w-4 h-4 text-primary" />
            Extract Component
          </h3>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} title="Close">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {selectedElements.length} element(s) selected for extraction
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Component Name */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Component Name</label>
          <Input
            value={componentName}
            onChange={e => setComponentName(e.target.value)}
            placeholder="MyComponent"
            className="font-mono text-sm"
          />
        </div>

        {/* Export Location */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Export Location</label>
          <Select
            value={exportLocation}
            onValueChange={setExportLocation}
            options={[
              DEFAULT_EXPORT_LOCATION,
              '@/components',
              '@/components/shared',
              '@/components/extracted',
              '@/ui',
            ].map(loc => ({ value: loc, label: loc }))}
            placeholder="Select export location"
          />
        </div>

        {/* Options */}
        <div className="space-y-2">
          <ToggleOption
            label="Add Props Interface"
            description="Generate TypeScript interface for props"
            checked={addPropsInterface}
            onChange={setAddPropsInterface}
          />
          <ToggleOption
            label="Include Styles"
            description="Keep inline styles and className"
            checked={includeStyles}
            onChange={setIncludeStyles}
          />
          <ToggleOption
            label="Generate Story"
            description="Create a Storybook-style story"
            checked={generateStory}
            onChange={setGenerateStory}
          />
        </div>

        <Separator />

        {/* Selected Elements Preview */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block flex items-center gap-2">
            <FileCode className="w-3.5 h-3.5" />
            Selected Elements
          </label>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {selectedElements.map((el, i) => (
              <div key={i} className="flex items-center gap-2 p-1.5 rounded border border-border text-xs">
                <code className="font-mono text-foreground">{el.tagName}</code>
                {el.className && (
                  <Badge variant="secondary" className="text-xs font-mono truncate">
                    {el.className.substring(0, 30)}
                  </Badge>
                )}
                <span className="text-muted-foreground ml-auto">Depth {el.depth}</span>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* Code Preview */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-muted-foreground">Generated Code</label>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={handleCopy} title="Copy">
                {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={handleDownload} title="Download">
                <Download className="w-3 h-3" />
              </Button>
            </div>
          </div>

          <pre className="text-xs font-mono bg-muted/50 border border-border rounded-lg p-3 overflow-x-auto max-h-64">
            <code>{previewCode}</code>
          </pre>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border">
        <Button
          className="w-full"
          onClick={handleExtract}
          disabled={!componentName.trim() || extracting}
        >
          {extracting ? (
            <>
              <span className="w-3.5 h-3.5 mr-1.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Extracting...
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 mr-1.5" />
              Extract {componentName || 'Component'}
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

/**
 * Toggle option row
 */
const ToggleOption: React.FC<{
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, description, checked, onChange }) => {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 rounded border-border"
      />
      <div>
        <div className="text-sm text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </label>
  );
};

/**
 * Generate component code from selected elements
 */
function generateComponentCode(
  name: string,
  elements: ExtractedElement[],
  options: {
    addPropsInterface: boolean;
    generateStory: boolean;
    includeStyles: boolean;
    exportLocation: string;
  }
): string {
  const { addPropsInterface, generateStory, includeStyles, exportLocation } = options;

  // Build component body
  const body = elements.map((el, i) => {
    const indent = el.depth > 1 ? '  '.repeat(el.depth - 1) : '';
    return `${indent}${el.code.trim()}`;
  }).join('\n\n');

  const imports = [
    `import React from 'react';`,
    includeStyles ? `import { cn } from '@/lib/utils';` : '',
  ].filter(Boolean).join('\n');

  const interfaceBlock = addPropsInterface ? `
interface ${name}Props {
  className?: string;
  children?: React.ReactNode;
  /** Add your custom props here */
}
` : '';

  const componentSignature = addPropsInterface
    ? `export function ${name}({ className, children, ...props }: ${name}Props)`
    : `export function ${name}({ className, children, ...props }: { className?: string; children?: React.ReactNode })`;

  const styleComment = includeStyles ? '' : `
  // Note: styles were excluded from extraction. Add them manually or use Tailwind.
`;

  const storyBlock = generateStory ? `

// Story (for Storybook or component docs)
export const ${name}Story = {
  component: ${name},
  args: {
    children: 'Sample content',
  },
};
` : '';

  return `${imports}
${interfaceBlock}
${componentSignature} {
  return (
${body}
  );
}
${storyBlock}`;
}

export default ComponentExtractor;