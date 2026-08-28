<script setup lang="ts">
import { computed } from 'vue';
import { tv, type VariantProps } from 'tailwind-variants';

interface Props extends VariantProps<typeof cardVariants> {
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

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  padding: 'default',
});

const classes = computed(() => cardVariants({
  variant: props.variant,
  padding: props.padding,
  class: props.class,
}));
</script>

<template>
  <div :class="classes" v-bind="$attrs">
    <slot />
  </div>
</template>