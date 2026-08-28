import { mergeProps, splitProps } from 'solid-js';
import { tv, type VariantProps } from 'tailwind-variants';

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
  readOnly?: boolean;
  /** Input value */
  value?: string;
  /** Default value */
  defaultValue?: string;
  /** Input name */
  name?: string;
  /** Input id */
  id?: string;
  /** Aria label */
  ariaLabel?: string;
  /** Additional classes */
  class?: string;
  /** Auto complete */
  autocomplete?: string;
  /** Change handler */
  onChange?: (event: Event) => void;
  /** Input handler */
  onInput?: (event: Event) => void;
  /** Focus handler */
  onFocus?: (event: FocusEvent) => void;
  /** Blur handler */
  onBlur?: (event: FocusEvent) => void;
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

export function Input(props: InputProps) {
  const [local, rest] = splitProps(props, [
    'type',
    'placeholder',
    'disabled',
    'required',
    'readOnly',
    'value',
    'defaultValue',
    'name',
    'id',
    'ariaLabel',
    'class',
    'autocomplete',
    'size',
    'onChange',
    'onInput',
    'onFocus',
    'onBlur',
  ]);

  const { type = 'text', placeholder, disabled = false, required = false, readOnly = false, value, defaultValue, name, id, ariaLabel, class: className = '', autocomplete, size = 'default', onChange, onInput, onFocus, onBlur } = local;

  const classes = inputVariants({ size, class: className });
  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <input
      {...rest}
      type={type}
      id={inputId}
      name={name}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      readOnly={readOnly}
      value={value ?? defaultValue}
      class={classes}
      aria-label={ariaLabel}
      autocomplete={autocomplete}
      onChange={onChange}
      onInput={onInput}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );
}