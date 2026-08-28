<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { tv, type VariantProps } from 'tailwind-variants';

  const dispatch = createEventDispatcher<{
    click: MouseEvent;
  }>();

  export interface ButtonProps extends VariantProps<typeof buttonVariants> {
    /** Button variant */
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
    /** Button size */
    size?: 'default' | 'sm' | 'lg' | 'icon';
    /** Disable the button */
    disabled?: boolean;
    /** Render as anchor tag */
    asChild?: boolean;
    /** Href for anchor rendering */
    href?: string;
    /** Additional classes */
    class?: string;
    /** Button type */
    type?: 'button' | 'submit' | 'reset';
  }

  const buttonVariants = tv({
    base: 'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  });

  const {
    variant = 'default',
    size = 'default',
    disabled = false,
    asChild = false,
    href,
    class: className = '',
    type = 'button',
    ...restProps
  } = $$props as ButtonProps;

  const classes = buttonVariants({ variant, size, class: className });

  function handleClick(event: MouseEvent) {
    if (disabled) {
      event.preventDefault();
      return;
    }
    dispatch('click', event);
  }
</script>

{#if asChild && href}
  <a
    href={href}
    class={classes}
    aria-disabled={disabled}
    tabindex={disabled ? -1 : 0}
    on:click={handleClick}
    {...restProps}
  >
    {@render children?.()}
  </a>
{:else if href}
  <a
    href={href}
    class={classes}
    aria-disabled={disabled}
    tabindex={disabled ? -1 : 0}
    on:click={handleClick}
    {...restProps}
  >
    {@render children?.()}
  </a>
{:else}
  <button
    type={type}
    class={classes}
    disabled={disabled}
    on:click={handleClick}
    {...restProps}
  >
    {@render children?.()}
  </button>
{/if}