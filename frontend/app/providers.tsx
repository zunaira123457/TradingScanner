'use client';

import type { ReactNode } from 'react';
import { ThemeProvider, useTheme } from 'next-themes';
import { Toaster } from 'sonner';

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme === 'light' ? 'light' : 'dark'} position="bottom-right" richColors closeButton />;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      {children}
      <ThemedToaster />
    </ThemeProvider>
  );
}
