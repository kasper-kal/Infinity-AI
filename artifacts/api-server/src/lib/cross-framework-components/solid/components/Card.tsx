import { mergeProps, splitProps } from 'solid-js';
import { tv, type VariantProps } from 'tailwind-variants';

export interface CardProps extends VariantProps<typeof cardVariants> {
  /** Additional classes */
  class?: string;
  /** Children */
  children?: JSX.Element;
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

export function Card(props: CardProps) {
  const [local, rest] = splitProps(props, ['variant', 'padding', 'class', 'children']);

  const { variant = 'default', padding = 'default', class: className = '', children } = local;

  const classes = cardVariants({ variant, padding, class: className });

  return (
    <div {...rest} class={classes}>
      {children}
    </div>
  );
}