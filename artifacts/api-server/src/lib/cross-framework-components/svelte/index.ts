/**
 * Svelte Cross-Framework Components
 * shadcn/ui compatible components for Svelte
 */

export { default as Button } from './components/Button.svelte';
export { default as Input } from './components/Input.svelte';
export { default as Card } from './components/Card.svelte';
export { default as Dialog } from './components/Dialog.svelte';

// Re-export types
export type { ButtonProps } from './components/Button.svelte';
export type { InputProps } from './components/Input.svelte';
export type { CardProps } from './components/Card.svelte';
export type { DialogProps, DialogTriggerProps, DialogContentProps, DialogHeaderProps, DialogTitleProps, DialogDescriptionProps, DialogFooterProps, DialogCloseProps } from './components/Dialog.svelte';