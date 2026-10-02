'use client';

import { useActionState } from 'react';
import { Button } from '@/components/button';
import { Field, FormAlert, FormSuccess } from '@/components/form-field';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Input } from '@/components/ui/input';
import { requestPasswordResetAction, type ForgotPasswordState } from './actions';

const initialState: ForgotPasswordState = {};

/** The answer never says whether the address is an admin's (ADR-038). */
export function ForgotPasswordForm({
  ttlMinutes,
  siteKey,
}: {
  ttlMinutes: number;
  siteKey: string;
}) {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  if (state.sentTo) {
    return (
      <div className="flex flex-col gap-4">
        <FormSuccess>
          If <strong>{state.sentTo}</strong> belongs to an organizer account, a link to choose a new
          password is on its way. It works once, for {ttlMinutes} minutes.
        </FormSuccess>
        <p className="text-sm text-muted-foreground">
          Nothing after a few minutes? Check the spam folder, then ask again.
        </p>
        {state.exposedLink ? (
          <a
            href={state.exposedLink}
            className="text-sm underline"
            data-testid="exposed-reset-link"
          >
            Open the reset link (development only)
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error ? <FormAlert>{state.error}</FormAlert> : null}
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
          defaultValue={state.email ?? ''}
          className="h-12 text-base"
        />
      </Field>
      <TurnstileWidget siteKey={siteKey} action="password-reset" resetSignal={state} />
      <Button type="submit" disabled={pending} className="h-12 w-full text-base">
        {pending ? 'Sending…' : 'Send a reset link'}
      </Button>
    </form>
  );
}
