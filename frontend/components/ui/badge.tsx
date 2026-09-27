import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const badgeVariants = cva('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none', {
  variants: {
    tone: {
      neutral: 'bg-panel-2 text-muted',
      up: 'bg-up-soft text-up',
      down: 'bg-down-soft text-down',
      warn: 'bg-warn-soft text-warn',
      accent: 'bg-accent-soft text-accent',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
