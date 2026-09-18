import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** S5: label above, control, then a one-line hint in muted text. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
}

export function FieldHint({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-snug text-muted-foreground">{children}</p>;
}

/**
 * S8 error summary: `role="alert"` so the e2e specs (and screen readers) find
 * it. `title` distinguishes a user problem from an outage when the caller
 * knows which (B1 words the two differently on purpose).
 */
export function FormAlert({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Alert
      role="alert"
      variant="destructive"
      className="border-l-4 border-destructive/30 border-l-destructive bg-destructive-tint"
    >
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function FormSuccess({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-md bg-success-tint px-3 py-2 text-sm text-success">
      {children}
    </p>
  );
}
