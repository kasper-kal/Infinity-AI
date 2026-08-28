/**
 * Vue Cross-Framework Components
 * shadcn/ui compatible components for Vue (Nuxt)
 */

export { default as Button } from './components/Button.vue';
export { default as Input } from './components/Input.vue';
export { default as Card } from './components/Card.vue';

// Re-export types
export type { Props as ButtonProps } from './components/Button.vue';
export type { Props as InputProps } from './components/Input.vue';
export type { Props as CardProps } from './components/Card.vue';