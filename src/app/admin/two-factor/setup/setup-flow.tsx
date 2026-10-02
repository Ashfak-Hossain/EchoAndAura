'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { BackupCodesList } from '@/components/admin/backup-codes-list';
import { Button } from '@/components/button';
import { Field, FieldHint, FormAlert } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import {
  confirmSetupAction,
  startSetupAction,
  type ConfirmSetupState,
  type StartSetupState,
} from './actions';

const inputClass = 'h-12 text-base aria-invalid:bg-destructive-tint';

function StepLabel({ n }: { n: 1 | 2 | 3 }) {
  return (
    <p className="font-sans text-xs font-medium tracking-widest text-muted-foreground uppercase">
      Step {n} of 3
    </p>
  );
}

/**
 * ADR-049 setup in three steps: password → scan and type the first code →
 * the backup codes. "Start again" remounts the steps (a fresh pair of
 * action states) when the factor being confirmed no longer exists.
 */
export function SetupFlow() {
  const [attempt, setAttempt] = useState(0);
  return <Steps key={attempt} onRestart={() => setAttempt((n) => n + 1)} />;
}

function Steps({ onRestart }: { onRestart: () => void }) {
  const [start, startAction, startPending] = useActionState<StartSetupState, FormData>(
    startSetupAction,
    {},
  );
  const [confirm, confirmAction, confirmPending] = useActionState<ConfirmSetupState, FormData>(
    confirmSetupAction,
    {},
  );

  if (!start.setup) {
    return (
      <form action={startAction} className="flex flex-col gap-5">
        <StepLabel n={1} />
        {start.error ? <FormAlert>{start.error}</FormAlert> : null}
        <Field
          label="Current password"
          htmlFor="password"
          hint="Proves it is you before a new sign-in method is added."
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={startPending}
            aria-invalid={start.field === 'password' || undefined}
            className={inputClass}
          />
        </Field>
        <Button type="submit" disabled={startPending} className="h-12 w-full text-base">
          {startPending ? 'Checking…' : 'Continue'}
        </Button>
      </form>
    );
  }

  // Shown only after the first code proved the app works: codes for a
  // factor that never got turned on would be useless.
  if (confirm.done) return <SavedCodes codes={start.setup.backupCodes} />;

  const { qr, secret } = start.setup;
  return (
    <form action={confirmAction} className="flex flex-col gap-5">
      <StepLabel n={2} />
      <p className="text-sm">
        Open Google Authenticator, Microsoft Authenticator or 1Password, tap +, and scan this code.
      </p>
      {/* Each pass through step 1 makes a new secret; an entry from an
          earlier pass shows codes that never work here, and at sign-in
          its wrong codes count towards the 15-minute lock. */}
      <FieldHint>
        Scanned an echoandaura code before? Delete that entry in the app first: only this one works.
      </FieldHint>
      {/* A data: URL rendered on the server; next/image adds nothing here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qr}
        alt="QR code for your authenticator app"
        width={200}
        height={200}
        className="self-center rounded-lg border border-border bg-white p-2"
      />
      <div className="flex flex-col gap-1.5">
        <FieldHint>Can&apos;t scan it? Choose to enter a key in the app and type:</FieldHint>
        <code
          data-testid="totp-secret"
          className="rounded-md bg-secondary px-3 py-2 font-mono text-sm tracking-wide break-all select-all"
        >
          {secret}
        </code>
      </div>
      {confirm.error ? (
        <FormAlert>
          {confirm.error}
          {confirm.restart ? (
            <>
              {' '}
              <button
                type="button"
                onClick={onRestart}
                className="font-medium underline underline-offset-4 hover:no-underline"
              >
                Start again
              </button>
            </>
          ) : null}
        </FormAlert>
      ) : null}
      <Field
        label="Code from the app"
        htmlFor="code"
        hint="The app shows a new 6-digit code every 30 seconds. Type the one showing now."
      >
        <Input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          disabled={confirmPending}
          aria-invalid={(Boolean(confirm.error) && !confirm.restart) || undefined}
          className={`${inputClass} font-mono tracking-widest`}
        />
      </Field>
      <Button type="submit" disabled={confirmPending} className="h-12 w-full text-base">
        {confirmPending ? 'Checking…' : 'Turn on two-factor'}
      </Button>
    </form>
  );
}

function SavedCodes({ codes }: { codes: string[] }) {
  const router = useRouter();
  // The codes live only in this component's state, and two-factor is
  // already on: a reload or a back swipe lands on /admin and they are gone.
  // Ask first. "I have saved these codes" is a client navigation, which
  // does not fire beforeunload.
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return (
    <div className="flex flex-col gap-5">
      <StepLabel n={3} />
      <p className="text-sm">
        Two-factor is on. If you ever lose your phone, sign in with one of these backup codes
        instead of the app code.
      </p>
      <BackupCodesList codes={codes} />
      <FieldHint>
        Left this page before saving them? Make new ones on Your account, under Two-factor sign-in.
      </FieldHint>
      <Button
        type="button"
        className="h-12 w-full text-base"
        onClick={() => router.replace('/admin')}
      >
        I have saved these codes
      </Button>
    </div>
  );
}
