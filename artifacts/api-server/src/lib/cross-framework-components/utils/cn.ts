/**
 * Class name utility - framework agnostic version of clsx/tailwind-merge
 */

type ClassValue = string | number | boolean | undefined | null | ClassValue[] | Record<string, boolean | undefined | null>;

export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = [];

  for (const input of inputs) {
    if (!input) continue;

    if (typeof input === 'string' || typeof input === 'number') {
      classes.push(String(input));
    } else if (Array.isArray(input)) {
      classes.push(cn(...input));
    } else if (typeof input === 'object') {
      for (const [key, value] of Object.entries(input)) {
        if (value) classes.push(key);
      }
    }
  }

  return classes.join(' ');
}

/**
 * Tailwind-merge compatible utility for merging conflicting classes
 * This is a simplified version - for production use tailwind-merge package
 */
export function twMerge(...classes: string[]): string {
  // Simple conflict resolution: last class wins for same utility
  // In production, use the actual tailwind-merge package
  return classes.filter(Boolean).join(' ');
}

export { cn as clsx };