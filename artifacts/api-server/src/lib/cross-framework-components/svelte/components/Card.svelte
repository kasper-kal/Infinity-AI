<script lang="ts">
  import { tv, type VariantProps } from 'tailwind-variants';

  export interface CardProps extends VariantProps<typeof cardVariants> {
    /** Additional classes */
    class?: string;
  }

  const cardVariants = tv({
    base: 'rounded-lg border bg-card text-card-foreground shadow-sm',
    variants: {
      variant: {
        default: '',
        outlined: 'border-border',
        elevated: 'shadow-md',
      },
      padding: {
        none: '',
        default: 'p-6',
        sm: 'p-4',
        lg: 'p-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      padding: 'default',
    },
  });

  const { variant = 'default', padding = 'default', class: className = '', ...restProps } = $$props as CardProps;
  const classes = cardVariants({ variant, padding, class: className });
</script>

<div class={classes} {...restProps}>
  {@render children?.()}
</div>