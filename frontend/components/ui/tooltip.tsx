'use client';

import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';

export const TooltipProvider = TooltipPrimitive.Provider;

/** Minimal tooltip: wraps a single focusable child. */
export function Tip({ content, children }: { content: React.ReactNode; children: React.ReactElement }) {
  return (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-50 max-w-xs rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-text shadow-lg"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
