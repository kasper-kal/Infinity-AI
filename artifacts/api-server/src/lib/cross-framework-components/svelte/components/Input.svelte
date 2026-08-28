<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { tv, type VariantProps } from 'tailwind-variants';

  const dispatch = createEventDispatcher<{
    focus: FocusEvent;
    blur: FocusEvent;
    change: Event;
    input: Event;
  }>();

  export interface InputProps extends VariantProps<typeof inputVariants> {
    /** Input type */
    type?: string;
    /** Placeholder text */
    placeholder?: string;
    /** Disable the input */
    disabled?: boolean;
    /** Required field */
    required?: boolean;
    /** Read only */
    readonly?: boolean;
    /** Input value */
    value?: string;
    /** Default value */
    defaultValue?: string;
    /** Input name */
    name?: string;
    /** Input id */
    id?: string;
    /** Aria label */
    'aria-label'?: string;
    /** Additional classes */
    class?: string;
    /** Auto complete */
    autocomplete?: string;
  }

  const inputVariants = tv({
    base: 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
    variants: {
      size: {
        default: 'h-10 px-3 py-2',
        sm: 'h-9 px-3 py-1.5 text-xs',
        lg: 'h-11 px-4 py-3 text-base',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  });

  const {
    type = 'text',
    placeholder,
    disabled = false,
    required = false,
    readonly = false,
    value,
    defaultValue,
    name,
    id,
    'aria-label': ariaLabel,
    class: className = '',
    autocomplete,
    size = 'default',
    ...restProps
  } = $$props as InputProps;

  const classes = inputVariants({ size, class: className });
  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

  function handleFocus(event: FocusEvent) {
    dispatch('focus', event);
  }

  function handleBlur(event: FocusEvent) {
    dispatch('blur', event);
  }

  function handleChange(event: Event) {
    dispatch('change', event);
  }

  function handleInput(event: Event) {
    dispatch('input', event);
  }
</script>

<input
  type={type}
  id={inputId}
  name={name}
  placeholder={placeholder}
  disabled={disabled}
  required={required}
  readonly={readonly}
  value={value}
  class={classes}
  aria-label={ariaLabel}
  autocomplete={autocomplete}
  on:focus={handleFocus}
  on:blur={handleBlur}
  on:change={handleChange}
  on:input={handleInput}
  {...restProps}
/>