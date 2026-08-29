import React, { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui';
import { Check, ChevronDown, ChevronUp, Code, LayoutGrid, Smartphone, Globe, Zap, Layers } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export interface FrameworkInfo {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: 'web' | 'mobile' | 'fullstack' | 'static';
  features: string[];
  recommended: boolean;
  version: string;
  packageManager: string[];
}

export const FRAMEWORKS: FrameworkInfo[] = [
  {
    id: 'nextjs',
    name: 'Next.js',
    description: 'React framework with App Router, Server Components, and full-stack capabilities',
    icon: <Globe className="w-5 h-5" />,
    category: 'fullstack',
    features: ['App Router', 'Server Components', 'API Routes', 'Static Export', 'Image Optimization', 'Middleware'],
    recommended: true,
    version: '14+',
    packageManager: ['npm', 'pnpm', 'yarn', 'bun'],
  },
  {
    id: 'vite-react',
    name: 'Vite + React',
    description: 'Fast SPA development with React 18, TypeScript, and modern tooling',
    icon: <Zap className="w-5 h-5" />,
    category: 'web',
    features: ['Lightning Fast HMR', 'React 18 + TS', 'Plugin Ecosystem', 'Optimized Build', 'ESM Native'],
    recommended: true,
    version: '5+',
    packageManager: ['npm', 'pnpm', 'yarn', 'bun'],
  },
  {
    id: 'astro',
    name: 'Astro',
    description: 'Content-focused framework with island architecture for optimal performance',
    icon: <Layers className="w-5 h-5" />,
    category: 'static',
    features: ['Island Architecture', 'Zero JS by Default', 'Multi-Framework', 'Content Collections', 'Partial Hydration'],
    recommended: false,
    version: '4+',
    packageManager: ['npm', 'pnpm', 'yarn', 'bun'],
  },
  {
    id: 'remix',
    name: 'Remix',
    description: 'Full-stack React framework with nested routing and progressive enhancement',
    icon: <Code className="w-5 h-5" />,
    category: 'fullstack',
    features: ['Nested Routes', 'Loaders/Actions', 'Progressive Enhancement', 'Web Standards', 'Edge Ready'],
    recommended: false,
    version: '2+',
    packageManager: ['npm', 'pnpm', 'yarn', 'bun'],
  },
  {
    id: 'sveltekit',
    name: 'SvelteKit',
    description: 'Svelte framework with file-based routing, SSR, and adapter-based deployment',
    icon: <LayoutGrid className="w-5 h-5" />,
    category: 'fullstack',
    features: ['File-based Routing', 'SSR + SSG', 'Adapter Platforms', 'Actions + Load', 'Granular Reactivity'],
    recommended: false,
    version: '2+',
    packageManager: ['npm', 'pnpm', 'yarn', 'bun'],
  },
  {
    id: 'vue-nuxt',
    name: 'Nuxt / Vue',
    description: 'Vue framework with auto-imports, SSR, and powerful module system',
    icon: <Globe className="w-5 h-5" />,
    category: 'fullstack',
    features: ['Auto Imports', 'File-based Routing', 'SSR + SSG', 'Modules', 'TypeScript Native'],
    recommended: false,
    version: '3+',
    packageManager: ['npm', 'pnpm', 'yarn', 'bun'],
  },
  {
    id: 'solidstart',
    name: 'SolidStart',
    description: 'SolidJS framework with fine-grained reactivity and island architecture',
    icon: <Zap className="w-5 h-5" />,
    category: 'fullstack',
    features: ['Fine-grained Reactivity', 'Islands', 'SSR + SSG', 'No Virtual DOM', 'Signals Native'],
    recommended: false,
    version: '1+',
    packageManager: ['npm', 'pnpm', 'yarn', 'bun'],
  },
];

interface FrameworkSelectorProps {
  selectedFramework: string;
  onSelect: (frameworkId: string) => void;
  className?: string;
  compact?: boolean;
}

export const FrameworkSelector: React.FC<FrameworkSelectorProps> = ({
  selectedFramework,
  onSelect,
  className = '',
  compact = false,
}) => {
  const { t } = useI18n();
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const categories = ['all', 'fullstack', 'web', 'static', 'mobile'] as const;

  const filteredFrameworks = FRAMEWORKS.filter((fw) => {
    if (activeCategory === 'all') return true;
    return fw.category === activeCategory;
  });

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case 'all': return t('uiBuilder.frameworkCategories.all') || 'All';
      case 'fullstack': return t('uiBuilder.frameworkCategories.fullstack') || 'Full-Stack';
      case 'web': return t('uiBuilder.frameworkCategories.web') || 'Web App';
      case 'static': return t('uiBuilder.frameworkCategories.static') || 'Static Site';
      case 'mobile': return t('uiBuilder.frameworkCategories.mobile') || 'Mobile';
      default: return cat;
    }
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'fullstack': return <Layers className="w-4 h-4" />;
      case 'web': return <Globe className="w-4 h-4" />;
      case 'static': return <LayoutGrid className="w-4 h-4" />;
      case 'mobile': return <Smartphone className="w-4 h-4" />;
      default: return <LayoutGrid className="w-4 h-4" />;
    }
  };

  if (compact) {
    return (
      <div className={`flex flex-wrap gap-2 ${className}`}>
        {FRAMEWORKS.map((fw) => (
          <Button
            key={fw.id}
            variant={selectedFramework === fw.id ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => onSelect(fw.id)}
            className="gap-1.5"
          >
            {fw.icon}
            <span>{fw.name}</span>
            {fw.recommended && (
              <Badge variant="success" className="text-xs">
                {t('uiBuilder.frameworkRecommended') || 'Recommended'}
              </Badge>
            )}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Category Tabs */}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('uiBuilder.frameworkCategories.label') || 'Framework categories'}>
        {categories.map((cat) => (
          <Button
            key={cat}
            variant={activeCategory === cat ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setActiveCategory(cat)}
            className="gap-1.5"
            role="tab"
            aria-selected={activeCategory === cat}
          >
            {getCategoryIcon(cat)}
            <span>{getCategoryLabel(cat)}</span>
          </Button>
        ))}
      </div>

      {/* Framework Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filteredFrameworks.map((fw) => (
          <FrameworkCard
            key={fw.id}
            framework={fw}
            isSelected={selectedFramework === fw.id}
            onSelect={() => onSelect(fw.id)}
          />
        ))}
      </div>

      {/* Current Selection Summary */}
      <div className="p-3 bg-muted/50 rounded-lg border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              {t('uiBuilder.currentFramework') || 'Current Framework:'}
            </span>
            <Badge variant={selectedFramework === 'nextjs' || selectedFramework === 'vite-react' ? 'success' : 'default'}>
              {FRAMEWORKS.find(f => f.id === selectedFramework)?.name || selectedFramework}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {t('uiBuilder.frameworkWillApply') || 'Will apply to generated components and project scaffold'}
          </span>
        </div>
      </div>
    </div>
  );
};

interface FrameworkCardProps {
  framework: FrameworkInfo;
  isSelected: boolean;
  onSelect: () => void;
}

const FrameworkCard: React.FC<FrameworkCardProps> = ({ framework, isSelected, onSelect }) => {
  return (
    <Button
      variant={isSelected ? 'primary' : 'outline'}
      className={`relative h-auto p-4 text-left transition-all ${
        isSelected ? 'border-primary bg-primary/5 shadow-sm' : 'hover:border-primary/50'
      }`}
      onClick={onSelect}
    >
      {isSelected && (
        <div className="absolute -top-1 -right-1">
          <Check className="w-5 h-5 text-primary" />
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          {framework.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-medium text-sm">{framework.name}</h4>
            {framework.recommended && (
              <Badge variant="success" className="text-xs">
                {t('uiBuilder.frameworkRecommended') || 'Recommended'}
              </Badge>
            )}
          </div>

          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {framework.description}
          </p>

          <div className="flex flex-wrap gap-1 mb-2">
            {framework.features.slice(0, 4).map((feature, i) => (
              <Badge key={i} variant="outline" className="text-xs h-4 px-1.5">
                {feature}
              </Badge>
            ))}
            {framework.features.length > 4 && (
              <Badge variant="outline" className="text-xs h-4 px-1.5">
                +{framework.features.length - 4} more
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Code className="w-3 h-3" />
              v{framework.version}
            </span>
            <span className="flex items-center gap-1">
              <LayoutGrid className="w-3 h-3" />
              {framework.packageManager.join(', ')}
            </span>
          </div>
        </div>
      </div>
    </Button>
  );
};

export default FrameworkSelector;