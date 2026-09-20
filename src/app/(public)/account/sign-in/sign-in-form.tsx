'use client';

import { useActionState } from 'react';
import { Button } from '@/components/button';
import { FieldHint } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SignInState } from './actions';

export function SignInForm({
  action,
}: {
  action: (prev: SignInState, formData: FormData) => Promise<SignInState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  if (state.sentTo) {
    return (
      <div
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
        role="status"
      >
        <p className="text-lg font-semibold">Check your inbox</p>
        <p className="text-[15px] leading-relaxed text-[#4a4640]">
          If <strong>{state.sentTo}</strong> has placed an order with us, a sign-in link is on its
          way. It works once and expires in 15 minutes. Nothing arrived? Check spam, or try again.
        </p>
        {state.exposedLink ? (
          <a
            href={state.exposedLink}
            className="text-sm underline"
            data-testid="exposed-magic-link"
          >
            Open the sign-in link (development only)
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.error ? (
        <p
          role="alert"
          className="rounded-xl border border-l-4 border-destructive/30 border-l-destructive bg-destructive-tint px-4 py-3 text-sm leading-relaxed"
        >
          {state.error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          className="h-11 bg-card"
        />
        <FieldHint>
          The address you used when registering. No password — we email you a link.
        </FieldHint>
      </div>
      <Button type="submit" variant="cta" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </Button>
    </form>
  );
}
