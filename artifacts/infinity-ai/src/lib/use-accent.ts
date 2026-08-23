export type AccentName = 'blue' | 'green' | 'purple' | 'orange' | 'pink';

const ACCENTS: Record<AccentName, { light: string; dark: string }> = {
  blue: { light: '211 100% 50%', dark: '211 100% 60%' },
  green: { light: '152 100% 38%', dark: '152 100% 45%' },
  purple: { light: '271 76% 53%', dark: '271 76% 63%' },
  orange: { light: '24 100% 50%', dark: '24 100% 55%' },
  pink: { light: '330 100% 50%', dark: '330 100% 60%' },
};

export function applyAccent(accent: string | null = null, resolvedTheme?: 'dark' | 'light') {
  const stored = accent ?? (() => {
    try { return localStorage.getItem('jarvis-accent'); } catch { return null; }
  })();
  const name = (stored && stored in ACCENTS ? stored : 'blue') as AccentName;
  const dark = resolvedTheme
    ? resolvedTheme === 'dark'
    : document.documentElement.classList.contains('dark');
  const value = dark ? ACCENTS[name].dark : ACCENTS[name].light;
  document.documentElement.style.setProperty('--primary', value);
  document.documentElement.style.setProperty('--ring', `${value} / 0.3`);
  return name;
}

export function applyStoredAccent() {
  return applyAccent();
}
