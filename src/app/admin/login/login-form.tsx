'use client';

import { useActionState, useState } from 'react';
import { Field, FormAlert } from '@/components/form-field';
import { Button } from '@/components/button';
import { Input } from '@/components/ui/input';
import { signInAction, type SignInState } from './actions';

const initialState: SignInState = {};

// B1: two failure classes worded differently on purpose (the action decides
// which); pending disables both fields and says what is happening.
export function LoginForm() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const outage = state.error?.startsWith('Sign-in is temporarily unavailable');
  // Credential errors mark both fields (B1). The email is kept; the password
  // is deliberately cleared — React resets uncontrolled inputs after an action.
  const invalid = Boolean(state.error) && !outage;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error ? (
        <FormAlert
          title={outage ? 'Sign-in temporarily unavailable.' : 'Invalid email or password.'}
        >
          {outage
            ? 'The database is not answering. Nothing is lost — try again in a minute.'
            : 'Check both fields and try again.'}
          <span className="sr-only"> {state.error}</span>
        </FormAlert>
      ) : null}

      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
          defaultValue={state.email ?? ''}
          aria-invalid={invalid || undefined}
          className="h-12 text-base aria-invalid:bg-destructive-tint"
        />
      </Field>

      <Field label="Password" htmlFor="password">
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            disabled={pending}
            aria-invalid={invalid || undefined}
            className="h-12 pr-16 text-base aria-invalid:bg-destructive-tint"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-pressed={showPassword}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </Field>

      <Button type="submit" disabled={pending} className="h-12 w-full text-base">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
