'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Search-as-you-type for the admin tables. The value is pushed to the caller
 * after a 300 ms pause (or on Enter); the caller writes it to the URL, which
 * stays the single source of truth. `value` is what the URL currently holds:
 * when it changes for a reason other than our own push (a "Clear" link, the
 * back button), the box follows it.
 */
export interface SearchBoxProps {
  /** The term the URL currently holds. */
  value: string;
  onSearch: (term: string) => void;
  placeholder: string;
  /**
   * True while the caller's navigation is in flight (`useTransition`).
   * Required: it is also how the box tells its own push apart from a URL
   * change it must follow.
   */
  pending: boolean;
  className?: string;
}

export function SearchBox({ value, onSearch, placeholder, pending, className }: SearchBoxProps) {
  const [q, setQ] = useState(value);
  // The last term we handed to the caller. State, not a ref, so that a push
  // (Enter) cancels the pending debounce timer through the effect below.
  const [lastPushed, setLastPushed] = useState(value);

  // The URL moved without us (Clear link, back button): adopt it. Our own
  // pushes are skipped so a term still being typed is never overwritten.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== lastPushed) {
      setLastPushed(value);
      setQ(value);
    }
  } else if (!pending && value !== lastPushed) {
    // Our push was superseded by another navigation (a sort link, the back
    // button) and never landed: the URL won, so the box follows it. `pending`
    // and `lastPushed` are set in the same batch by a push, so this never
    // fires between the push and its navigation.
    setLastPushed(value);
    setQ(value);
  }

  const push = (term: string) => {
    if (term === lastPushed) return;
    setLastPushed(term);
    onSearch(term);
  };

  // Debounced search → caller. Keyed on `lastPushed` too: an Enter or an
  // outside clear cancels the timer, so a stale push can never land after a
  // soft navigation and put the old term back into the URL.
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed === lastPushed) return;
    const t = setTimeout(() => push(trimmed), 300);
    return () => clearTimeout(t);
    // push is recreated each render; the debounce keys on q and lastPushed only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, lastPushed]);

  return (
    <div className={cn('relative w-65 max-w-full', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        name="q"
        aria-label="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') push(q.trim());
        }}
        placeholder={placeholder}
        maxLength={80}
        className="h-9 bg-card pl-8 text-[13px]"
      />
      {pending ? (
        <span className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-border-strong border-t-foreground" />
      ) : null}
    </div>
  );
}
