import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Props {
  label: string;
  value: ReactNode;
  /** One line under the number: a trend, a zero-state truth, or an action link. */
  detail?: ReactNode;
  /** Draw attention (B3: "Pending verification" is the urgent one). */
  emphasis?: boolean;
  className?: string;
}

/** S9 StatCard: overline label, display number, one detail line. */
export function StatCard({ label, value, detail, emphasis, className }: Props) {
  return (
    <Card className={cn('gap-0 py-5', emphasis && 'border-primary/60 bg-accent', className)}>
      <CardContent className="flex flex-col gap-2 px-5">
        <span className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          {label}
        </span>
        <span className="font-heading text-3xl leading-none font-semibold tabular">{value}</span>
        {detail ? <span className="text-sm text-muted-foreground">{detail}</span> : null}
      </CardContent>
    </Card>
  );
}
