import type { ReactNode } from 'react';
import { render, renderHook } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';

/** Fresh SWR cache per test, no dedupe, no retry noise. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0, shouldRetryOnError: false }}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <TooltipProvider>{children}</TooltipProvider>
      </ThemeProvider>
    </SWRConfig>
  );
}

export const renderWithProviders = (ui: ReactNode) => render(ui, { wrapper: Providers });
export const renderHookWithProviders = <R, P>(cb: (p: P) => R, opts: { initialProps?: P } = {}) =>
  renderHook(cb, { wrapper: Providers, ...opts });
