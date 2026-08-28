/**
 * Component Intermediate Representation (IR)
 *
 * Framework-agnostic component representation that can be transpiled to any target framework.
 * This is the "source of truth" — all frameworks generate from this IR.
 */

import { z } from 'zod';
import type { ImportStatement, PropDefinition } from './framework-adapters';

// ============================================================================
// Component IR Schema
// ============================================================================

export const ComponentIRSchema = z.object({
  name: z.string(),
  type: z.enum(['component', 'page', 'layout', 'hook', 'util']),
  description: z.string().optional(),
  imports: z.array(z.object({
    from: z.string(),
    named: z.array(z.string()),
    default: z.string().optional(),
    type: z.enum(['value', 'type']).optional(),
  })),
  props: z.array(z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean(),
    default: z.string().optional(),
    description: z.string().optional(),
  })),
  jsx: z.string(), // JSX source (React-compatible)
  styles: z.string().optional(),
  stateHooks: z.array(z.object({
    name: z.string(),
    initialValue: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
  effects: z.array(z.object({
    body: z.string(),
    deps: z.array(z.string()).optional(),
  })).optional(),
  handlers: z.array(z.object({
    name: z.string(),
    params: z.array(z.string()).optional(),
    body: z.string(),
    async: z.boolean().optional(),
  })).optional(),
  metadata: z.record(z.any()).optional(),
});

export type ComponentIR = z.infer<typeof ComponentIRSchema>;

export interface TranspileOptions {
  targetFramework: string;
  designSystem?: Record<string, any>;
  stylingStrategy?: 'tailwind' | 'css-modules' | 'styled-components' | 'unocss' | 'native';
}

export interface TranspileResult {
  files: Array<{ path: string; content: string; language: string }>;
  warnings: string[];
  errors: string[];
}

// ============================================================================
// IR Builder
// ============================================================================

export class ComponentIRBuilder {
  private ir: Partial<ComponentIR> = {
    imports: [],
    props: [],
    stateHooks: [],
    effects: [],
    handlers: [],
  };

  static create(name: string, type: ComponentIR['type'] = 'component'): ComponentIRBuilder {
    const builder = new ComponentIRBuilder();
    builder.ir.name = name;
    builder.ir.type = type;
    return builder;
  }

  description(desc: string): this {
    this.ir.description = desc;
    return this;
  }

  import(from: string, named: string[], defaultName?: string, type?: 'value' | 'type'): this {
    this.ir.imports!.push({ from, named, default: defaultName, type });
    return this;
  }

  prop(name: string, type: string, required = false, defaultValue?: string, description?: string): this {
    this.ir.props!.push({ name, type, required, default: defaultValue, description });
    return this;
  }

  jsx(jsx: string): this {
    this.ir.jsx = jsx;
    return this;
  }

  styles(styles: string): this {
    this.ir.styles = styles;
    return this;
  }

  stateHook(name: string, initialValue?: string, type?: string): this {
    this.ir.stateHooks!.push({ name, initialValue, type });
    return this;
  }

  effect(body: string, deps?: string[]): this {
    this.ir.effects!.push({ body, deps });
    return this;
  }

  handler(name: string, body: string, params?: string[], async?: boolean): this {
    this.ir.handlers!.push({ name, body, params, async });
    return this;
  }

  metadata(key: string, value: any): this {
    this.ir.metadata = this.ir.metadata || {};
    this.ir.metadata[key] = value;
    return this;
  }

  build(): ComponentIR {
    if (!this.ir.name || !this.ir.jsx) {
      throw new Error('ComponentIR requires name and jsx');
    }
    return this.ir as ComponentIR;
  }
}

// ============================================================================
// IR Parser — Parse framework-specific code into IR
// ============================================================================

export class ComponentIRParser {
  /**
   * Parse React/JSX/TSX code into ComponentIR
   */
  static fromReact(code: string, componentName: string): ComponentIR {
    const imports = this.parseImports(code);
    const props = this.parseProps(code);
    const jsx = this.extractJSX(code, componentName);
    const stateHooks = this.parseStateHooks(code);
    const effects = this.parseEffects(code);
    const handlers = this.parseHandlers(code);

    return {
      name: componentName,
      type: 'component',
      imports,
      props,
      jsx,
      stateHooks,
      effects,
      handlers,
    };
  }

  private static parseImports(code: string): ImportStatement[] {
    const imports: ImportStatement[] = [];
    const importRegex = /import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = importRegex.exec(code)) !== null) {
      const defaultImport = match[1];
      const namedImports = match[2]
        ? match[2].split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const from = match[3];

      imports.push({
        from,
        named: namedImports,
        default: defaultImport || undefined,
      });
    }

    return imports;
  }

  private static parseProps(code: string): PropDefinition[] {
    const props: PropDefinition[] = [];
    // Match interface Props or type Props
    const propsInterfaceRegex = /(?:interface|type)\s+(\w*[Pp]rops\w*)\s*(?:=\s*)?\{([^}]*)\}/;
    const match = propsInterfaceRegex.exec(code);

    if (match) {
      const body = match[2];
      const propRegex = /(\w+)(\?)?:\s*([^;]+);/g;
      let propMatch;

      while ((propMatch = propRegex.exec(body)) !== null) {
        props.push({
          name: propMatch[1],
          required: !propMatch[2],
          type: propMatch[3].trim(),
        });
      }
    }

    return props;
  }

  private static extractJSX(code: string, componentName: string): string {
    // Find the return statement or JSX block
    const returnRegex = new RegExp(`return\\s*\\(([\\s\\S]*?)\\);\\s*}`, 'm');
    const match = returnRegex.exec(code);

    if (match) {
      return match[1].trim();
    }

    // Fallback: find JSX between first { and last }
    const arrowRegex = new RegExp(`${componentName}\\s*=\\s*(?:\\(\\s*\\w*\\s*\\)\\s*=>|function\\s*\\w*\\s*\\()\\s*=>?\\s*\\{?([\\s\\S]*)`);
    const arrowMatch = arrowRegex.exec(code);

    if (arrowMatch) {
      return arrowMatch[1].trim();
    }

    return code;
  }

  private static parseStateHooks(code: string): Array<{ name: string; initialValue?: string; type?: string }> {
    const hooks: Array<{ name: string; initialValue?: string; type?: string }> = [];
    const useStateRegex = /const\s+\[(\w+),\s*\w+\]\s*=\s*useState<([^>]*)>?\(([^)]*)\)/g;
    let match;

    while ((match = useStateRegex.exec(code)) !== null) {
      hooks.push({
        name: match[1],
        initialValue: match[3],
        type: match[2] || undefined,
      });
    }

    return hooks;
  }

  private static parseEffects(code: string): Array<{ body: string; deps?: string[] }> {
    const effects: Array<{ body: string; deps?: string[] }> = [];
    const effectRegex = /useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\}(?:\s*,\s*\[([^\]]*)\])?\)/g;
    let match;

    while ((match = effectRegex.exec(code)) !== null) {
      const deps = match[2]
        ? match[2].split(',').map(s => s.trim()).filter(Boolean)
        : undefined;
      effects.push({ body: match[1].trim(), deps });
    }

    return effects;
  }

  private static parseHandlers(code: string): Array<{ name: string; params?: string[]; body: string; async?: boolean }> {
    const handlers: Array<{ name: string; params?: string[]; body: string; async?: boolean }> = [];
    const handlerRegex = /(async\s+)?function\s+(\w+)\(([^)]*)\)\s*\{([\s\S]*?)\n\}/g;
    let match;

    while ((match = handlerRegex.exec(code)) !== null) {
      const params = match[3].split(',').map(s => s.trim()).filter(Boolean);
      handlers.push({
        name: match[2],
        params,
        body: match[4].trim(),
        async: !!match[1],
      });
    }

    return handlers;
  }
}

// ============================================================================
// IR Transpiler — Convert IR to framework-specific output
// ============================================================================

export class ComponentIRTranspiler {
  static transpile(ir: ComponentIR, options: TranspileOptions): TranspileResult {
    switch (options.targetFramework) {
      case 'nextjs':
      case 'vite-react':
      case 'remix':
        return this.toReact(ir, options);
      case 'astro':
        return this.toAstro(ir, options);
      case 'sveltekit':
        return this.toSvelte(ir, options);
      case 'vue-nuxt':
        return this.toVue(ir, options);
      case 'solidstart':
        return this.toSolid(ir, options);
      default:
        return {
          files: [],
          warnings: [`Unknown framework: ${options.targetFramework}`],
          errors: [`No transpiler for ${options.targetFramework}`],
        };
    }
  }

  private static toReact(ir: ComponentIR, options: TranspileOptions): TranspileResult {
    const warnings: string[] = [];
    const errors: string[] = [];

    const importLines = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        const typeKeyword = imp.type === 'type' ? 'type ' : '';
        return `import ${typeKeyword}${combined} from '${imp.from}';`;
      })
      .join('\n');

    const propsInterface = ir.props.length > 0
      ? `interface ${ir.name}Props {\n${ir.props
          .map(p => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`)
          .join('\n')}\n}\n`
      : '';

    const stateLines = (ir.stateHooks || [])
      .map(hook => `  const [${hook.name}, set${this.capitalize(hook.name)}] = useState<${hook.type || 'any'}>(${hook.initialValue || 'undefined'});`)
      .join('\n');

    const effectLines = (ir.effects || [])
      .map(effect => `  useEffect(() => {\n${effect.body}\n  }, [${effect.deps?.join(', ') || ''}]);`)
      .join('\n\n');

    const handlerLines = (ir.handlers || [])
      .map(handler => `  ${handler.async ? 'async ' : ''}function ${handler.name}(${handler.params?.join(', ') || ''}) {\n${handler.body}\n  }`)
      .join('\n\n');

    const propsType = ir.props.length > 0 ? `${ir.name}Props` : '{}';

    const componentCode = `${importLines}

${propsInterface}
export function ${ir.name}({ ${ir.props.map(p => p.name).join(', ')} }: ${propsType}) {
${stateLines ? stateLines + '\n' : ''}
${effectLines ? effectLines + '\n' : ''}
${handlerLines ? handlerLines + '\n' : ''}
  return (
${ir.jsx}
  );
}
`;

    const extension = options.targetFramework === 'nextjs' ? 'tsx' : 'tsx';
    const path = ir.type === 'page'
      ? `src/app/${ir.name.toLowerCase()}/page.${extension}`
      : ir.type === 'layout'
      ? `src/app/layout.${extension}`
      : `src/components/${ir.name}.${extension}`;

    return {
      files: [{
        path,
        content: componentCode,
        language: 'typescript',
      }],
      warnings,
      errors,
    };
  }

  private static toAstro(ir: ComponentIR, options: TranspileOptions): TranspileResult {
    const warnings: string[] = ['Astro uses .astro syntax — JSX converted to Astro template syntax'];
    const errors: string[] = [];

    const importLines = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        return `import ${combined} from '${imp.from}';`;
      })
      .join('\n');

    // Convert JSX to Astro syntax
    let astroTemplate = ir.jsx
      .replace(/className=/g, 'class=')
      .replace(/htmlFor=/g, 'for=')
      .replace(/\{([^}]+)\}/g, (match, expr) => `{${expr}}`);

    const componentCode = `---
${importLines}

${ir.props.length > 0 ? `interface Props {\n${ir.props.map(p => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`).join('\n')}\n}\nconst { ${ir.props.map(p => p.name).join(', ')} } = Astro.props;` : ''}

${(ir.stateHooks || []).map(hook => `let ${hook.name} = ${hook.initialValue || 'undefined'};`).join('\n')}
---

${astroTemplate}
`;

    return {
      files: [{
        path: `src/components/${ir.name}.astro`,
        content: componentCode,
        language: 'astro',
      }],
      warnings,
      errors,
    };
  }

  private static toSvelte(ir: ComponentIR, options: TranspileOptions): TranspileResult {
    const warnings: string[] = ['Svelte uses .svelte syntax — JSX converted to Svelte template syntax'];
    const errors: string[] = [];

    const scriptImports = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        return `import ${combined} from '${imp.from}';`;
      })
      .join('\n');

    // Convert JSX to Svelte syntax
    let svelteTemplate = ir.jsx
      .replace(/className=/g, 'class=')
      .replace(/onClick=\{.*?\}/g, (match) => {
        const handler = match.match(/\{(.*?)\}/)?.[1] || '';
        return `on:click={${handler}}`;
      })
      .replace(/\{(\w+)\}/g, '{$1}');

    const componentCode = `<script lang="ts">
${scriptImports}

export let ${ir.props.map(p => `${p.name}${p.required ? '' : ` = ${p.default || 'undefined'}`}`).join(', ')};

${(ir.stateHooks || []).map(hook => `let ${hook.name} = ${hook.initialValue || 'undefined'};`).join('\n')}
${ir.props.map(p => `export type ${this.capitalize(p.name)}Type = ${p.type};`).join('\n')}

${(ir.handlers || []).map(handler => `${handler.async ? 'async ' : ''}function ${handler.name}(${handler.params?.join(', ') || ''}) {\n${handler.body}\n}`).join('\n\n')}
</script>

${svelteTemplate}
`;

    return {
      files: [{
        path: `src/lib/components/${ir.name}.svelte`,
        content: componentCode,
        language: 'svelte',
      }],
      warnings,
      errors,
    };
  }

  private static toVue(ir: ComponentIR, options: TranspileOptions): TranspileResult {
    const warnings: string[] = ['Vue uses .vue syntax — JSX converted to Vue template syntax'];
    const errors: string[] = [];

    const scriptImports = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        return `import ${combined} from '${imp.from}';`;
      })
      .join('\n');

    // Convert JSX to Vue template syntax
    let vueTemplate = ir.jsx
      .replace(/className=/g, 'class=')
      .replace(/onClick=\{.*?\}/g, (match) => {
        const handler = match.match(/\{(.*?)\}/)?.[1] || '';
        return `@click="${handler}"`;
      })
      .replace(/\{(\w+)\}/g, '{{ $1 }}')
      .replace(/<\s*(\w+)\s*>/g, '<$1>')
      .replace(/\{\{\s*(\w+)\s*\}\}/g, '{{ $1 }}'); // Normalize

    const componentCode = `<script setup lang="ts">
${scriptImports}

${ir.props.map(p => `const props = defineProps<{ ${p.name}${p.required ? '' : '?'}: ${p.type} }>();`).join('\n')}

${(ir.stateHooks || []).map(hook => `const ${hook.name} = ref<${hook.type || 'any'}>(${hook.initialValue || 'undefined'});`).join('\n')}

${(ir.handlers || []).map(handler => `${handler.async ? 'async ' : ''}function ${handler.name}(${handler.params?.join(', ') || ''}) {\n${handler.body}\n}`).join('\n\n')}
</script>

<template>
${vueTemplate}
</template>

<style scoped>
${ir.styles || ''}
</style>
`;

    return {
      files: [{
        path: `src/components/${ir.name}.vue`,
        content: componentCode,
        language: 'vue',
      }],
      warnings,
      errors,
    };
  }

  private static toSolid(ir: ComponentIR, options: TranspileOptions): TranspileResult {
    const warnings: string[] = ['Solid uses .tsx syntax similar to React — minor adjustments for Solid reactivity'];
    const errors: string[] = [];

    const importLines = ir.imports
      .map(imp => {
        const named = imp.named.length > 0 ? `{ ${imp.named.join(', ')} }` : '';
        const defaultPart = imp.default || '';
        const combined = [defaultPart, named].filter(Boolean).join(', ');
        const typeKeyword = imp.type === 'type' ? 'type ' : '';
        const solidFrom = imp.from === 'react' ? 'solid-js' : imp.from;
        return `import ${typeKeyword}${combined} from '${solidFrom}';`;
      })
      .join('\n');

    const propsInterface = ir.props.length > 0
      ? `interface ${ir.name}Props {\n${ir.props
          .map(p => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`)
          .join('\n')}\n}\n`
      : '';

    const stateLines = (ir.stateHooks || [])
      .map(hook => `  const [${hook.name}, set${this.capitalize(hook.name)}] = createSignal<${hook.type || 'any'}>(<${hook.type || 'any'}>${hook.initialValue || 'undefined'});`)
      .join('\n');

    const componentCode = `${importLines}

${propsInterface}
export function ${ir.name}(props: ${ir.props.length > 0 ? `${ir.name}Props` : '{}'}) {
${stateLines ? stateLines + '\n' : ''}
  return (
${ir.jsx}
  );
}
`;

    return {
      files: [{
        path: `src/components/${ir.name}.tsx`,
        content: componentCode,
        language: 'typescript',
      }],
      warnings,
      errors: [],
    };
  }

  private static capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

// ============================================================================
// Public API Functions
// ============================================================================

/**
 * Transpile ComponentIR to framework-specific code
 */
export function componentIRToFramework(
  ir: ComponentIR,
  targetFramework: string,
  options: TranspileOptions
): TranspileResult {
  return ComponentIRTranspiler.transpile(ir, { ...options, targetFramework });
}

/**
 * Parse framework-specific code into ComponentIR
 */
export function parseFrameworkComponent(
  code: string,
  framework: string,
  componentName: string
): { success: boolean; ir?: ComponentIR; error?: string } {
  try {
    let ir: ComponentIR;
    switch (framework) {
      case 'nextjs':
      case 'vite-react':
      case 'remix':
        ir = ComponentIRParser.fromReact(code, componentName);
        break;
      case 'astro':
        ir = ComponentIRParser.fromAstro?.(code, componentName) || ComponentIRParser.fromReact(code, componentName);
        break;
      case 'sveltekit':
        ir = ComponentIRParser.fromSvelte?.(code, componentName) || ComponentIRParser.fromReact(code, componentName);
        break;
      case 'vue-nuxt':
        ir = ComponentIRParser.fromVue?.(code, componentName) || ComponentIRParser.fromReact(code, componentName);
        break;
      case 'solidstart':
        ir = ComponentIRParser.fromSolid?.(code, componentName) || ComponentIRParser.fromReact(code, componentName);
        break;
      default:
        return { success: false, error: `Unsupported framework: ${framework}` };
    }
    const validation = ComponentIRSchema.safeParse(ir);
    if (!validation.success) {
      return { success: false, error: validation.error.message };
    }
    return { success: true, ir: validation.data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
