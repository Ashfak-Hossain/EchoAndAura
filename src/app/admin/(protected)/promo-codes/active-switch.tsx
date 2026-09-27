'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { Switch } from '@/components/ui/switch';
import { setPromoActiveAction } from './actions';

/**
 * B10 Active switch. Flips at once (optimistic) and settles on the server's
 * answer; on failure it springs back and says why. Off stops new uses —
 * orders already discounted keep their price.
 */
export function ActiveSwitch({ id, code, active }: { id: string; code: string; active: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(active);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Switch
        checked={optimistic}
        disabled={pending}
        aria-label={`${code} active`}
        onCheckedChange={(next: boolean) => {
          setError(null);
          start(async () => {
            setOptimistic(next);
            try {
              const r = await setPromoActiveAction(id, next);
              if (!r.ok) setError(r.error);
            } catch {
              setError('Could not change it. Please try again.');
            }
          });
        }}
      />
      {error ? (
        <span role="alert" className="text-xs font-medium text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
