'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/button';
import { FormAlert } from '@/components/form-field';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { deleteSponsorAction } from './actions';
import { useAnnounce, useStatusRegion } from './list-status';

/**
 * B15 delete, confirmed first (the design's dialog). From a list row the
 * row just goes and the status line says so; from the edit form it goes
 * back to the list with the same message. Hiding is the gentler option,
 * and the dialog says so.
 */
export function DeleteSponsorButton({
  id,
  name,
  from,
}: {
  id: string;
  name: string;
  from: 'row' | 'form';
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const region = useStatusRegion();
  // Set once the row is gone, so the dialog hands focus to the status line
  // (which now says "<name> deleted.") instead of the vanished trigger.
  const deleted = useRef(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirm() {
    setError(null);
    start(async () => {
      try {
        const r = await deleteSponsorAction(id);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        deleted.current = true;
        setOpen(false);
        if (from === 'form') router.replace(`/admin/sponsors?deleted=${encodeURIComponent(name)}`);
        else announce(`${name} deleted.`);
      } catch {
        setError('Could not delete it. Please try again.');
      }
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <AlertDialogTrigger
        render={
          from === 'form' ? (
            <button
              type="button"
              className="h-11 rounded-md px-1 text-[15px] font-semibold text-destructive underline underline-offset-[3px] outline-none hover:text-[#911d17] focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
            />
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={cn(
                'border-[#efc4c0] text-destructive hover:bg-destructive-tint',
                'h-11 lg:h-9',
              )}
            />
          )
        }
      >
        {from === 'form' ? 'Delete sponsor' : 'Delete'}
        {from === 'row' ? <span className="sr-only"> {name}</span> : null}
      </AlertDialogTrigger>
      <AlertDialogContent
        finalFocus={() => (deleted.current && region?.current ? region.current : true)}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The logo and link come off the home page and footer straight away. This can’t be undone.
            To hide a sponsor for now, turn off Active instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <AlertDialogFooter>
          <AlertDialogCancel
            render={<Button type="button" variant="secondary" />}
            disabled={pending}
          >
            Cancel
          </AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
            {pending ? 'Deleting…' : 'Delete sponsor'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
