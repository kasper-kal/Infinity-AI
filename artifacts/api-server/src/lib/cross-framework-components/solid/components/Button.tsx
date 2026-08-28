import { mergeProps, splitProps } from 'solid-js';
import { tv, type VariantProps } from 'tailwind-variants';

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
  /** Children */
  children?: JSX.Element;
  /** Click handler */
  onClick?: (event: MouseEvent) => void;
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

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, [
    'variant',
    'size',
    'disabled',
    'asChild',
    'href',
    'class',
    'type',
    'onClick',
    'children',
  ]);

  const { variant = 'default', size = 'default', disabled = false, asChild = false, href, class: className = '', type = 'button', onClick, children } = local;

  const classes = buttonVariants({ variant, size, class: className });

  function handleClick(event: MouseEvent) {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  const isAnchor = asChild || !!href;

  if (isAnchor) {
    return (
      <a
        {...rest}
        href={href}
        class={classes}
        aria-disabled={disabled}
        tabindex={disabled ? -1 : 0}
        onClick={handleClick}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      {...rest}
      type={type}
      class={classes}
      disabled={disabled}
      aria-disabled={disabled}
      tabindex={disabled ? -1 : 0}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}