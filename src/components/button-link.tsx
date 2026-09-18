import Link from 'next/link';
import type { ComponentProps } from 'react';
import type { VariantProps } from 'class-variance-authority';
import { buttonVariants } from '@/components/button';
import { cn } from '@/lib/utils';

type Props = ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>;

/**
 * A real link styled as an S4 button. Navigation stays a link (role,
 * middle-click, screen readers); a Button `render` prop would make it a button.
 */
export function ButtonLink({ className, variant, size, ...props }: Props) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
