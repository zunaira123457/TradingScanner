'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/usePersistentState';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      // The theme is only known on the client; keep SSR markup theme-agnostic.
      aria-label={hydrated ? `Switch to ${next} theme` : 'Toggle theme'}
      title="Toggle theme (T)"
    >
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  );
}
