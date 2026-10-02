'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { BackupCodesList } from '@/components/admin/backup-codes-list';
import { Button } from '@/components/button';
import { Field, FormAlert, FormSuccess } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { NEW_PASSWORD_MIN } from '@/lib/validation/auth';
import {
  changeEmailAction,
  changePasswordAction,
  regenerateBackupCodesAction,
  type BackupCodesState,
  type ChangeEmailState,
  type ChangePasswordState,
} from './actions';

/** Same card as Settings (B14). */
function Card({ title, lead, children }: { title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="font-sans text-xs font-medium tracking-widest text-muted-foreground uppercase">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{lead}</p>
      </div>
      {children}
    </section>
  );
}

const inputClass = 'h-11 aria-invalid:bg-destructive-tint';

export function ChangePasswordForm({ changed }: { changed: boolean }) {
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(
    changePasswordAction,
    {},
  );
  return (
    <Card
      title="Password"
      lead="Changing it signs you out on every other device. This one stays signed in."
    >
      <form action={formAction} className="flex flex-col gap-5">
        {changed && !state.error ? (
          <FormSuccess>Password changed. Every other device is signed out.</FormSuccess>
        ) : null}
        {state.error ? <FormAlert>{state.error}</FormAlert> : null}
        <Field label="Current password" htmlFor="current">
          <Input
            id="current"
            name="current"
            type="password"
            autoComplete="current-password"
            required
            disabled={pending}
            aria-invalid={state.field === 'current' || undefined}
            className={inputClass}
          />
        </Field>
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
            className={inputClass}
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
            className={inputClass}
          />
        </Field>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function ChangeEmailForm({ current, ttlMinutes }: { current: string; ttlMinutes: number }) {
  const [state, formAction, pending] = useActionState<ChangeEmailState, FormData>(
    changeEmailAction,
    {},
  );
  return (
    <Card
      title="Email"
      lead={
        <>
          You sign in with <strong className="text-foreground">{current}</strong>. A new address
          must confirm itself before it replaces this one.
        </>
      }
    >
      {state.sentTo ? (
        <div className="flex flex-col gap-3">
          <FormSuccess>
            A confirmation link is on its way to <strong>{state.sentTo}</strong>. Your email changes
            only when it is used, within {ttlMinutes} minutes. Then you are signed out everywhere
            and sign in with the new address.
          </FormSuccess>
          <p className="text-sm text-muted-foreground">
            A notice went to {current} too, in case this was not you.
          </p>
          {state.exposedLink ? (
            <a
              href={state.exposedLink}
              className="text-sm underline"
              data-testid="exposed-email-link"
            >
              Open the confirmation link (development only)
            </a>
          ) : null}
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-5">
          {state.error ? <FormAlert>{state.error}</FormAlert> : null}
          <Field label="New email" htmlFor="new-email">
            <Input
              id="new-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={pending}
              defaultValue={state.email ?? ''}
              aria-invalid={state.field === 'email' || undefined}
              className={inputClass}
            />
          </Field>
          <Field
            label="Current password"
            htmlFor="email-password"
            hint="Proves it is you, not someone at an unlocked computer."
          >
            <Input
              id="email-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={pending}
              aria-invalid={state.field === 'password' || undefined}
              className={inputClass}
            />
          </Field>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? 'Sending…' : 'Send a confirmation link'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/**
 * ADR-049: two-factor is mandatory, so there is no "turn off" here; only
 * new backup codes. Turning it off for a lost phone is the server script
 * (`admin:reset-2fa`), never this page.
 */
export function TwoFactorForm() {
  const [state, formAction, pending] = useActionState<BackupCodesState, FormData>(
    regenerateBackupCodesAction,
    {},
  );
  // "Done" hides this result's codes; a new result shows its own.
  const [dismissed, setDismissed] = useState<BackupCodesState | null>(null);
  const codes = state.backupCodes && dismissed !== state ? state.backupCodes : null;

  return (
    <Card
      title="Two-factor sign-in"
      lead={
        <>
          Status: <strong className="text-foreground">On</strong>. Signing in asks for the code from
          your authenticator app after the password.
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Lost or changed your phone? Sign in with a backup code, then ask the developer to reset
        two-factor: a new phone can only be set up after that.
      </p>
      {codes ? (
        <div className="flex flex-col gap-4">
          <FormSuccess>New backup codes made. Your old codes no longer work.</FormSuccess>
          <BackupCodesList codes={codes} />
          <div>
            <Button type="button" variant="secondary" onClick={() => setDismissed(state)}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-5">
          {state.error ? <FormAlert>{state.error}</FormAlert> : null}
          <Field
            label="Current password"
            htmlFor="codes-password"
            hint="Making new backup codes stops the old ones working at once."
          >
            <Input
              id="codes-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={pending}
              aria-invalid={state.field === 'password' || undefined}
              className={inputClass}
            />
          </Field>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? 'Making…' : 'Make new backup codes'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
