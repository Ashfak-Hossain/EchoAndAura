'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { COVER_IMAGE_MAX_BYTES, COVER_IMAGE_TYPES } from '@/server/lib/cover-image';
import { FormAlert } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { createCoverUploadAction, removeCoverImageAction, setCoverImageAction } from './actions';

interface Props {
  eventId: string;
  hasImage: boolean;
}

type Phase = 'idle' | 'preparing' | 'uploading' | 'saving' | 'removing';

// B5 cover upload. The three-step flow is the durable part:
//   1. ask the server for a presigned PUT   2. PUT the file straight to
//   storage from the browser                 3. tell the server the key.
export function CoverUpload({ eventId, hasImage }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const busy = phase !== 'idle';

  async function onFileChosen(file: File | undefined) {
    if (!file) return;
    setError(null);

    // Client-side pre-check for a fast message; the server re-validates.
    if (!(file.type in COVER_IMAGE_TYPES)) {
      setError('Cover image must be a JPEG, PNG or WebP');
      return;
    }
    if (file.size > COVER_IMAGE_MAX_BYTES) {
      setError('Cover image must be 5 MB or smaller');
      return;
    }

    try {
      setPhase('preparing');
      const prepared = await createCoverUploadAction(eventId, {
        contentType: file.type,
        size: file.size,
      });
      if (!prepared.ok) return setError(prepared.error);

      setPhase('uploading');
      const put = await fetch(prepared.data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!put.ok) return setError(`Upload failed (${put.status}). Please try again.`);

      setPhase('saving');
      const saved = await setCoverImageAction(eventId, prepared.data.key);
      if (!saved.ok) return setError(saved.error);

      router.refresh();
    } catch {
      setError('Upload failed. Check your connection and try again.');
    } finally {
      setPhase('idle');
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function onRemove() {
    setError(null);
    setPhase('removing');
    try {
      const result = await removeCoverImageAction(eventId);
      if (!result.ok) return setError(result.error);
      router.refresh();
    } finally {
      setPhase('idle');
    }
  }

  const label = {
    idle: null,
    preparing: 'Preparing…',
    uploading: 'Uploading…',
    saving: 'Saving…',
    removing: 'Removing…',
  }[phase];

  // B5 dropzone: card + input[type=file]; idle / uploading / rejected states.
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="px-6 pt-6">
        <CardTitle>{hasImage ? 'Replace cover image' : 'Upload a cover image'}</CardTitle>
        <CardDescription>JPG, PNG or WebP · up to 5 MB · 1200×630 or larger.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-6 pt-4 pb-6">
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-10 text-center text-sm transition-colors hover:bg-secondary',
            busy && 'pointer-events-none opacity-60',
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-accent text-lg text-accent-ink">
            ↑
          </span>
          <span className="font-medium">
            {hasImage ? 'Replace cover image' : 'Cover image'} — choose a file
          </span>
          <span className="text-muted-foreground">JPEG, PNG or WebP, up to 5 MB</span>
          <input
            ref={inputRef}
            type="file"
            data-testid="cover-file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => void onFileChosen(e.target.files?.[0])}
            className="sr-only"
          />
        </label>
        {label ? (
          <p role="status" className="text-sm text-muted-foreground">
            {label}
          </p>
        ) : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
        {hasImage ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => void onRemove()}
            disabled={busy}
            className="self-start"
          >
            Remove cover image
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
