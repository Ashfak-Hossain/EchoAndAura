import { cn } from '@/lib/utils';

interface Props<T extends string> {
  /** The radios' form field name. */
  name: string;
  /** The chosen option, or '' when none is chosen yet. */
  value: T | '';
  options: readonly (readonly [value: T, label: string])[];
  onChange: (value: T) => void;
  /** Id of an error message that describes the whole group. */
  describedBy?: string;
  invalid?: boolean;
}

/**
 * A segmented control built from real radio inputs (visually hidden), so the
 * choice submits with the form and arrow keys move between options like any
 * radio group. Wrap it in a <fieldset> whose <legend> names the choice.
 * Used by the promo code form (Type) and the sponsor form (Level, Tile).
 */
export function SegmentedControl<T extends string>({
  name,
  value,
  options,
  onChange,
  describedBy,
  invalid,
}: Props<T>) {
  return (
    <div
      className="inline-flex w-fit rounded-md border border-input bg-card p-0.5"
      role="radiogroup"
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
    >
      {options.map(([v, label]) => (
        <label
          key={v}
          className={cn(
            'cursor-pointer rounded-[5px] px-3.5 py-1.5 text-[13px] font-medium transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring',
            value === v
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          )}
        >
          <input
            type="radio"
            name={name}
            value={v}
            checked={value === v}
            onChange={() => onChange(v)}
            className="sr-only"
          />
          {label}
        </label>
      ))}
    </div>
  );
}
