'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { COVER_IMAGE_MAX_BYTES, COVER_IMAGE_TYPES } from '@/server/lib/cover-image';
import { createCoverUploadAction, removeCoverImageAction, setCoverImageAction } from './actions';

interface Props {
  eventId: string;
  hasImage: boolean;
}

type Phase = 'idle' | 'preparing' | 'uploading' | 'saving' | 'removing';

// TEMPORARY DEMO MARKUP — the real UI (dropzone, preview, crop guide) is
// designed separately. The three-step flow is the durable part:
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

  const label = { idle: null, preparing: 'Preparing…', uploading: 'Uploading…', saving: 'Saving…', removing: 'Removing…' }[phase];

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        {hasImage ? 'Replace cover image' : 'Cover image'} (JPEG, PNG or WebP, up to 5 MB)
        <input
          ref={inputRef}
          type="file"
          data-testid="cover-file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => void onFileChosen(e.target.files?.[0])}
          className="text-sm"
        />
      </label>
      {label ? (
        <p role="status" className="text-sm text-neutral-600">
          {label}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {hasImage ? (
        <button
          type="button"
          onClick={() => void onRemove()}
          disabled={busy}
          className="self-start rounded border border-red-600 px-3 py-2 text-sm text-red-600 disabled:opacity-50"
        >
          Remove cover image
        </button>
      ) : null}
    </div>
  );
}
