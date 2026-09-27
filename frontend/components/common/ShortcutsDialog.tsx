'use client';

import { Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';

const SHORTCUTS: [string, string][] = [
  ['↑ / ↓  or  K / J', 'Previous / next stock in watchlist'],
  ['1 – 6', 'Timeframe: 1m, 5m, 15m, 1H, 1D, 1W'],
  ['/', 'Search & add a symbol'],
  ['A', 'New price alert for selected stock'],
  ['N', 'Notification settings'],
  ['T', 'Toggle dark / light theme'],
  ['?', 'Show this help'],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          <Keyboard />
        </Button>
      </DialogTrigger>
      <DialogContent title="Keyboard shortcuts">
        <dl className="divide-y divide-border text-sm">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-2">
              <dt className="num rounded bg-panel-2 px-2 py-0.5 text-xs">{k}</dt>
              <dd className="text-right text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
