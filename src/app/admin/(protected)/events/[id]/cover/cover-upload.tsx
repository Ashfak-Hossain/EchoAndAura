'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { COVER_IMAGE_MAX_BYTES, COVER_IMAGE_TYPES } from '@/server/lib/cover-image';
import { FormAlert } from '@/components/form-field';
import { Button } from '@/components/button';
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
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
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
      setProgress({ loaded: 0, total: file.size });
      const status = await putWithProgress(prepared.data.uploadUrl, file, (loaded) =>
        setProgress({ loaded, total: file.size }),
      );
      if (status < 200 || status >= 300) {
        return setError(`Upload failed (${status}). Please try again.`);
      }

      setPhase('saving');
      const saved = await setCoverImageAction(eventId, prepared.data.key);
      if (!saved.ok) return setError(saved.error);

      router.refresh();
    } catch {
      setError('Upload failed. Check your connection and try again.');
    } finally {
      setPhase('idle');
      setProgress(null);
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
          <div role="status" className="flex flex-col gap-2 text-sm text-muted-foreground">
            <span>
              {label}
              {phase === 'uploading' && progress
                ? ` · ${percent(progress)}% · ${mb(progress.loaded)} of ${mb(progress.total)} MB`
                : ''}
            </span>
            {phase === 'uploading' && progress ? (
              <div className="h-2.5 w-full overflow-hidden rounded-[5px] bg-[#edeae3]">
                <div
                  className="h-full bg-foreground transition-[width]"
                  style={{ width: `${percent(progress)}%` }}
                />
              </div>
            ) : null}
          </div>
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

/** PUT via XHR so the browser can report upload progress (fetch cannot). */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (loaded: number) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => reject(new Error('network'));
    xhr.send(file);
  });
}

const percent = (p: { loaded: number; total: number }) =>
  p.total > 0 ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : 0;
const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
