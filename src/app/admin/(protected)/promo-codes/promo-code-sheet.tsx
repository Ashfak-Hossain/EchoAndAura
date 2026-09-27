'use client';

import { useRouter } from 'next/navigation';
import type { PromoPickerGroup } from '@/server/services/promo-codes.service';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { PromoCodeFormState, PromoCodeFormValues, RowActionResult } from './actions';
import { PromoCodeForm } from './promo-code-form';

/**
 * The sheet is driven by the URL (`?new=1` / `?edit=<id>`), so back,
 * refresh and a shared link all land on the same thing. Closing it
 * navigates back to the table.
 */
export function PromoCodeSheet({
  mode,
  action,
  deleteAction,
  initial,
  groups,
}: {
  mode: 'new' | 'edit';
  action: (prev: PromoCodeFormState, formData: FormData) => Promise<PromoCodeFormState>;
  deleteAction?: () => Promise<RowActionResult>;
  initial: PromoCodeFormValues;
  groups: PromoPickerGroup[];
}) {
  const router = useRouter();
  const close = () => router.replace('/admin/promo-codes', { scroll: false });

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : close())}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="px-6 pt-6 pb-4">
          <SheetTitle className="text-xl">
            {mode === 'new' ? 'New promo code' : `Edit ${initial.code}`}
          </SheetTitle>
          <SheetDescription>
            {mode === 'new'
              ? 'Unlimited uses. Works on every event unless you restrict it.'
              : 'Changes apply to new orders only; orders already placed keep their price.'}
          </SheetDescription>
        </SheetHeader>
        <PromoCodeForm
          action={action}
          deleteAction={deleteAction}
          initial={initial}
          editing={mode === 'edit'}
          groups={groups}
          onDone={close}
        />
      </SheetContent>
    </Sheet>
  );
}
