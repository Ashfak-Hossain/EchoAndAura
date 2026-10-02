'use client';

import { useState } from 'react';
import { Button } from '@/components/button';
import { FieldHint } from '@/components/form-field';

/**
 * ADR-049: the one-time backup codes, shown once — after setup and after
 * "Make new backup codes". Nothing here stores them: the page that showed
 * them is the only copy outside the (encrypted) database row.
 */
export function BackupCodesList({ codes }: { codes: string[] }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copyAll() {
    try {
      // Unavailable outside a secure context or when the browser refuses.
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  }

  function download() {
    const text = [
      'echoandaura organizer console: two-factor backup codes',
      'Each code works once. Keep them somewhere safe, away from your phone.',
      '',
      ...codes,
      '',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'echoandaura-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* One code per line, never split at its hyphen: "Ab3dE-" over
          "xfGh2" reads as two codes when copied by hand. Two columns need
          about 230px of list, more than the account card has at 320px. */}
      <ol
        data-testid="backup-codes"
        aria-label="Backup codes"
        className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-lg border border-border bg-secondary p-4 font-mono text-[15px] tracking-wide min-[360px]:grid-cols-2"
      >
        {codes.map((code) => (
          <li key={code} className="whitespace-nowrap select-all">
            {code}
          </li>
        ))}
      </ol>
      <p className="text-sm font-medium text-foreground">
        Each code works once. Keep them somewhere safe, away from your phone.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={copyAll}>
          {copy === 'copied' ? 'Copied' : 'Copy all'}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={download}>
          Download (.txt)
        </Button>
      </div>
      <div role="status">
        {copy === 'failed' ? (
          <FieldHint>Copy did not work here. Select the codes above and copy them.</FieldHint>
        ) : copy === 'copied' ? (
          <span className="sr-only">Backup codes copied</span>
        ) : null}
      </div>
    </div>
  );
}
