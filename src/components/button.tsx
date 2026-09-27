import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * S4 Button, to the pixel. shadcn's ui/button stays for its own internals
 * (dialog close etc.); admin and public screens use this one.
 *   primary     charcoal · hover #33302A
 *   secondary   white, border-strong · hover sunken
 *   ghost       transparent · hover sunken
 *   destructive danger · hover #911D17
 *   cta         marigold with charcoal ink — the public Register button only
 * Disabled is the same for all: sunken/white, light border, #A8A29A text.
 */
export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border font-semibold whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border disabled:text-[#a8a29a] [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'border-foreground bg-foreground text-background hover:border-[#33302a] hover:bg-[#33302a] disabled:bg-secondary',
        secondary:
          'border-border-strong bg-card text-foreground hover:bg-secondary disabled:bg-card',
        ghost:
          'border-transparent bg-transparent text-foreground hover:bg-secondary disabled:border-transparent',
        destructive:
          'border-destructive bg-destructive text-white hover:border-[#911d17] hover:bg-[#911d17] disabled:bg-secondary',
        cta: 'border-foreground bg-marigold text-foreground hover:bg-[#e2962c] disabled:bg-secondary',
      },
      size: {
        sm: 'h-9 px-3.5 text-[13px]',
        default: 'h-11 px-5 text-[15px]',
        lg: 'h-13 px-7 text-[17px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

type Props = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: Props) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
