'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/button';
import { Field, FormAlert } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { verifyCodeAction, type VerifyCodeState } from './actions';

const initialState: VerifyCodeState = {};

// ADR-049: one form, two inputs. The app's 6 digits by default; a backup
// code (one of the 10 saved at setup) when the phone is not at hand. The
// action reads whichever field is present.
export function VerifyForm() {
  const [state, formAction, pending] = useActionState(verifyCodeAction, initialState);
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');
  const outage = state.error?.startsWith('Sign-in is temporarily unavailable');
  // The wrong code is cleared (React resets uncontrolled inputs after an
  // action); the field stays marked until the next try.
  const invalid = Boolean(state.error) && !outage && state.mode === mode;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && state.mode === mode ? <FormAlert>{state.error}</FormAlert> : null}

      {mode === 'totp' ? (
        <Field label="Authentication code" htmlFor="code">
          <Input
            key="code"
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            // Room for "123 456" as some apps show it; the action strips spaces.
            maxLength={7}
            autoFocus
            required
            disabled={pending}
            aria-invalid={invalid || undefined}
            className="h-14 text-center font-mono text-2xl tracking-[0.3em] aria-invalid:bg-destructive-tint"
          />
        </Field>
      ) : (
        <Field
          label="Backup code"
          htmlFor="backupCode"
          hint="One of the 10 codes you saved when you set up the app. Each works once."
        >
          <Input
            key="backupCode"
            id="backupCode"
            name="backupCode"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Ab3dE-9fGh2"
            maxLength={13}
            autoFocus
            required
            disabled={pending}
            aria-invalid={invalid || undefined}
            className="h-12 font-mono text-base aria-invalid:bg-destructive-tint"
          />
        </Field>
      )}

      <Button type="submit" disabled={pending} className="h-12 w-full text-base">
        {pending ? 'Verifying…' : 'Verify'}
      </Button>

      <button
        type="button"
        onClick={() => setMode((m) => (m === 'totp' ? 'backup' : 'totp'))}
        disabled={pending}
        className="self-start text-sm font-medium text-foreground underline underline-offset-4 hover:no-underline disabled:text-muted-foreground"
      >
        {mode === 'totp' ? 'Use a backup code instead' : 'Use the authenticator app instead'}
      </button>
    </form>
  );
}
