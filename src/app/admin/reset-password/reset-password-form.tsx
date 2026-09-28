'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/button';
import { Field, FormAlert } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { NEW_PASSWORD_MIN } from '@/lib/validation/auth';
import { resetPasswordAction, type ResetPasswordState } from './actions';

const initialState: ResetPasswordState = {};

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);

  if (state.linkDead) return <DeadLink />;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error ? <FormAlert>{state.error}</FormAlert> : null}
      <input type="hidden" name="token" value={token} />
      <Field
        label="New password"
        htmlFor="password"
        hint={`At least ${NEW_PASSWORD_MIN} characters. A password manager can make one for you.`}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={NEW_PASSWORD_MIN}
          disabled={pending}
          aria-invalid={state.field === 'password' || undefined}
          className="h-12 text-base aria-invalid:bg-destructive-tint"
        />
      </Field>
      <Field label="New password again" htmlFor="confirm">
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          disabled={pending}
          aria-invalid={state.field === 'confirm' || undefined}
          className="h-12 text-base aria-invalid:bg-destructive-tint"
        />
      </Field>
      <Button type="submit" disabled={pending} className="h-12 w-full text-base">
        {pending ? 'Saving…' : 'Save the new password'}
      </Button>
    </form>
  );
}

export function DeadLink() {
  return (
    <div className="flex flex-col gap-4">
      <FormAlert title="This link no longer works.">
        It has expired or was already used. Links work once, for an hour.
      </FormAlert>
      <Link
        href="/admin/forgot-password"
        className="text-sm font-medium text-foreground underline underline-offset-4 hover:no-underline"
      >
        Ask for a new link
      </Link>
    </div>
  );
}
