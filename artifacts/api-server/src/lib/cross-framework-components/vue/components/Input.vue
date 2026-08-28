<script setup lang="ts">
import { computed } from 'vue';
import { tv, type VariantProps } from 'tailwind-variants';

interface Props extends VariantProps<typeof inputVariants> {
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
  ariaLabel?: string;
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

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  disabled: false,
  required: false,
  readonly: false,
  size: 'default',
});

const emit = defineEmits<{
  focus: [event: FocusEvent];
  blur: [event: FocusEvent];
  change: [event: Event];
  input: [event: Event];
  'update:value': [value: string];
}>();

const classes = computed(() => inputVariants({
  size: props.size,
  class: props.class,
}));

const inputId = props.id || `input-${Math.random().toString(36).substr(2, 9)}`;

function handleFocus(event: FocusEvent) {
  emit('focus', event);
}

function handleBlur(event: FocusEvent) {
  emit('blur', event);
}

function handleChange(event: Event) {
  const target = event.target as HTMLInputElement;
  emit('change', event);
  emit('update:value', target.value);
}

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  emit('input', event);
  emit('update:value', target.value);
}
</script>

<template>
  <input
    :type="props.type"
    :id="inputId"
    :name="props.name"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    :required="props.required"
    :readonly="props.readonly"
    :value="props.value ?? props.defaultValue"
    :class="classes"
    :aria-label="props.ariaLabel"
    :autocomplete="props.autocomplete"
    @focus="handleFocus"
    @blur="handleBlur"
    @change="handleChange"
    @input="handleInput"
    v-bind="$attrs"
  />
</template>