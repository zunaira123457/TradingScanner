'use client';

import { forwardRef, useEffect, useId, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useSymbolSearch } from '@/hooks/useStockData';
import { cn } from '@/lib/utils/cn';

interface Props {
  onPick: (symbol: string) => void;
  disabled?: boolean;
}

/** Debounced typeahead against /api/search; Enter on an exact ticker adds it directly. */
export const SymbolSearch = forwardRef<HTMLInputElement, Props>(function SymbolSearch({ onPick, disabled }, ref) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listId = useId();

  useEffect(() => {
    const id = setTimeout(() => setDebounced(text), 250);
    return () => clearTimeout(id);
  }, [text]);

  const { data, isLoading, error } = useSymbolSearch(debounced);
  const results = data?.results ?? [];

  const pick = (s: string) => {
    onPick(s.toUpperCase());
    setText('');
    setDebounced('');
    setOpen(false);
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
      <input
        ref={ref}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (results[active]) pick(results[active].symbol);
            else if (/^[A-Za-z][A-Za-z0-9.]{0,5}$/.test(text.trim())) pick(text.trim());
          } else if (e.key === 'Escape') {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={disabled ? 'Watchlist full (20)' : 'Add symbol…  ( / )'}
        aria-label="Search symbols to add to watchlist"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        className="h-8 w-full rounded-md border border-border bg-panel-2 pl-8 pr-2 text-sm placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      />
      {open && debounced && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-9 z-30 max-h-72 overflow-auto rounded-md border border-border bg-panel py-1 shadow-xl">
          {isLoading && <li className="px-3 py-2 text-xs text-muted">Searching…</li>}
          {error && <li className="px-3 py-2 text-xs text-down">Search unavailable — press Enter to add “{text.toUpperCase()}” directly</li>}
          {!isLoading && !error && results.length === 0 && <li className="px-3 py-2 text-xs text-muted">No US stocks match</li>}
          {results.map((r, i) => (
            <li key={r.symbol} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r.symbol)}
                className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', i === active ? 'bg-panel-2' : 'hover:bg-panel-2')}
              >
                <span className="num w-16 shrink-0 font-semibold">{r.symbol}</span>
                <span className="truncate text-xs text-muted">{r.description}</span>
                <Plus className="ml-auto size-3.5 text-faint" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
