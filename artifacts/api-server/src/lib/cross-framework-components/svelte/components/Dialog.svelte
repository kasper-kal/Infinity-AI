<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createEventDispatcher } from 'svelte';
  import { tv, type VariantProps } from 'tailwind-variants';

  const dispatch = createEventDispatcher<{
    openChange: boolean;
    close: void;
  }>();

  export interface DialogProps extends VariantProps<typeof dialogVariants> {
    /** Controlled open state */
    open?: boolean;
    /** Default open state (uncontrolled) */
    defaultOpen?: boolean;
    /** Close on overlay click */
    closeOnOverlayClick?: boolean;
    /** Close on escape key */
    closeOnEscape?: boolean;
    /** Additional classes */
    class?: string;
  }

  export interface DialogTriggerProps {
    /** Additional classes */
    class?: string;
    children: any;
  }

  export interface DialogContentProps extends VariantProps<typeof dialogContentVariants> {
    /** Additional classes */
    class?: string;
  }

  export interface DialogHeaderProps {
    /** Additional classes */
    class?: string;
  }

  export interface DialogTitleProps {
    /** Additional classes */
    class?: string;
  }

  export interface DialogDescriptionProps {
    /** Additional classes */
    class?: string;
  }

  export interface DialogFooterProps {
    /** Additional classes */
    class?: string;
  }

  export interface DialogCloseProps {
    /** Additional classes */
    class?: string;
    children?: any;
  }

  const dialogVariants = tv({
    base: '',
    variants: {},
  });

  const dialogContentVariants = tv({
    base: 'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
    variants: {
      size: {
        sm: 'max-w-sm',
        default: 'max-w-lg',
        lg: 'max-w-xl',
        xl: 'max-w-2xl',
        full: 'max-w-[90vw]',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  });

  // Dialog Root Component
  const {
    open,
    defaultOpen = false,
    closeOnOverlayClick = true,
    closeOnEscape = true,
    class: className = '',
    children,
    ...restProps
  } = $$props as DialogProps;

  let isOpen = $state(open ?? defaultOpen);
  let portalElement: HTMLElement | null = null;

  function handleOpenChange(newOpen: boolean) {
    isOpen = newOpen;
    dispatch('openChange', newOpen);
    if (!newOpen) {
      dispatch('close');
    }
  }

  function handleOverlayClick(event: MouseEvent) {
    if (closeOnOverlayClick && event.target === event.currentTarget) {
      handleOpenChange(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (closeOnEscape && event.key === 'Escape') {
      handleOpenChange(false);
    }
  }

  // Sync with controlled prop
  $effect.root(() => {
    $effect(() => {
      if (open !== undefined) {
        isOpen = open;
      }
    });
  });

  // Handle escape key and focus trap
  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeyDown);
    document.body.style.overflow = '';
  });

  // Portal to body
  if (!portalElement && typeof document !== 'undefined') {
    portalElement = document.createElement('div');
    document.body.appendChild(portalElement);
  }

  const trigger = ({ children }: DialogTriggerProps) => (
    <button
      type="button"
      on:click={() => handleOpenChange(true)}
      {...restProps}
    >
      {@render children?.()}
    </button>
  );

  const content = ({
    size = 'default',
    class: className = '',
    children,
    ...restProps
  }: DialogContentProps) => {
    const classes = dialogContentVariants({ size, class: className });

    if (!isOpen) return null;

    return (
      <div
        class="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        on:click={handleOverlayClick}
        aria-hidden="true"
      />
    ) + (
      <div
        class={classes}
        role="dialog"
        aria-modal="true"
        on:keydown={handleKeyDown}
        {...restProps}
      >
        {@render children?.()}
      </div>
    );
  };

  const header = ({ class: className = '', children }: DialogHeaderProps) => (
    <div class={`flex flex-col space-y-1.5 text-center sm:text-left ${className}`}>
      {@render children?.()}
    </div>
  );

  const title = ({ class: className = '', children }: DialogTitleProps) => (
    <h2 class={`text-lg font-semibold leading-none tracking-tight ${className}`}>
      {@render children?.()}
    </h2>
  );

  const description = ({ class: className = '', children }: DialogDescriptionProps) => (
    <p class={`text-sm text-muted-foreground ${className}`}>
      {@render children?.()}
    </p>
  );

  const footer = ({ class: className = '', children }: DialogFooterProps) => (
    <div class={`flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 ${className}`}>
      {@render children?.()}
    </div>
  );

  const close = ({ class: className = '', children }: DialogCloseProps) => (
    <button
      type="button"
      class={`absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground ${className}`}
      on:click={() => handleOpenChange(false)}
    >
      {children || (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      )}
    </button>
  );
</script>

<svelte:fragment>
  {#if isOpen}
    {@render content?.({ ...$$props, children })}
  {/if}
  {@render trigger?.({ children })}
</svelte:fragment>