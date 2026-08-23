/**
 * Subtle haptic feedback for aesthetic UI interactions.
 *
 * Wraps the Vibration API (navigator.vibrate), supported on Android
 * (Chrome/Edge/Firefox). It silently no-ops everywhere else (desktop
 * browsers, iOS Safari, and any device with vibration disabled), so
 * these calls are always safe.
 *
 * Presets are deliberately subtle: "light" for taps/toggles, "medium"
 * for confirms/sends, "heavy" for record/stop, "success" and "error"
 * for outcome feedback.
 */

export type HapticPattern = number | number[];

function canVibrate(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return false;
  }
  // Respect the user's reduced-motion / reduced-haptics preference.
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return false;
    }
  } catch {
    /* matchMedia unavailable, proceed */
  }
  return true;
}

function buzz(pattern: HapticPattern): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* not supported, ignore */
  }
}

export const haptics = {
  /** Faint tick, mode switches, theme toggles, navigation, list taps. */
  light: () => buzz(8),
  /** Slightly firmer, sends, opens panels, confirms. */
  medium: () => buzz(18),
  /** Noticeable pulse, record start/stop, destructive confirms. */
  heavy: () => buzz([20, 25, 20]),
  /** Double tick, success / completion. */
  success: () => buzz([12, 35, 12]),
  /** Longer single buzz, errors / warnings. */
  error: () => buzz([60]),
  /** Fire an arbitrary pattern (power users / custom components). */
  raw: (pattern: HapticPattern) => buzz(pattern),
};

export default haptics;
