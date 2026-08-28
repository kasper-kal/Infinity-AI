/**
 * Cross-Framework Component Library
 *
 * shadcn/ui compatible components for:
 * - Svelte (shadcn-svelte)
 * - Vue/Nuxt (shadcn-vue)
 * - SolidJS (shadcn-solid)
 *
 * All components share the same API design and Tailwind CSS styling.
 */

// Svelte components
export * from './svelte';

// Vue components
export * from './vue';

// Solid components
export * from './solid';

// Framework-agnostic utilities
export { cn } from './utils/cn';

// Component registry for code generation
export const COMPONENT_REGISTRY = {
  svelte: {
    Button: './components/Button.svelte',
    Input: './components/Input.svelte',
    Card: './components/Card.svelte',
    Dialog: './components/Dialog.svelte',
  },
  vue: {
    Button: './components/Button.vue',
    Input: './components/Input.vue',
    Card: './components/Card.vue',
  },
  solid: {
    Button: './components/Button.tsx',
    Input: './components/Input.tsx',
    Card: './components/Card.tsx',
  },
} as const;

export type SupportedFramework = 'svelte' | 'vue' | 'solid';
export type ComponentName = 'Button' | 'Input' | 'Card' | 'Dialog';

export function getComponentPath(framework: SupportedFramework, component: ComponentName): string | null {
  const registry = COMPONENT_REGISTRY[framework];
  return registry?.[component] ?? null;
}

export function getAvailableComponents(framework: SupportedFramework): ComponentName[] {
  const registry = COMPONENT_REGISTRY[framework];
  return registry ? Object.keys(registry) as ComponentName[] : [];
}