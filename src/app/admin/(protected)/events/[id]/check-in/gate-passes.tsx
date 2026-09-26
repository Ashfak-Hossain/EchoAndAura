import { doorService } from '@/server/container';
import { doorWindow, formatPassCode } from '@/server/lib/door-pass';
import { gatePassQrSvg } from '@/server/lib/qr';
import type { EventRecord } from '@/server/repositories/events.repository';
import type { PassState } from '@/server/services/door.service';
import { Chip } from '@/components/status-chip';
import type { ChipTone } from '@/lib/status-labels';
import { siteUrl } from '@/lib/env.public';
import { formatDhakaClock, formatDhakaShort } from '@/lib/time';
import { createGatePassAction, revokeAndUndoGatePassAction, revokeGatePassAction } from './actions';
import { NewGatePassForm, RevokeAndUndoButton, RevokeGatePassButton } from './gate-pass-controls';
import { OfflineConflicts } from './offline-conflicts';

const STATE: Record<PassState, { label: string; tone: ChipTone }> = {
  practice: { label: 'Practice until doors open', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  paused: { label: 'Not working — event unpublished', tone: 'warning' },
  ended: { label: 'Ended', tone: 'neutral' },
  revoked: { label: 'Revoked', tone: 'danger' },
};

/**
 * ADR-030 gate passes for one event: make one per gate, show it to the
 * door phone (QR of the pass link, or the code to type), revoke it. The
 * code is shown here in full on purpose — it is stored in plain text so a
 * replacement phone can be set up without making a new pass.
 */
export async function GatePasses({
  event,
  openPassId,
  now,
}: {
  event: EventRecord;
  /** The pass just created: shown open. */
  openPassId: string | null;
  now: Date;
}) {
  const rows = await doorService.listPasses(event);
  const window = doorWindow(event);
  const base = siteUrl();
  const qrs = new Map(
    await Promise.all(
      rows
        .filter((r) => r.state === 'practice' || r.state === 'active')
        .map(
          async (r) =>
            [r.pass.id, await gatePassQrSvg(`${base}/door#code=${r.pass.code}`)] as const,
        ),
    ),
  );
  const canCreate = event.status === 'published' && window.validUntil.getTime() > now.getTime();

  return (
    <section
      id="gate-passes"
      aria-labelledby="gate-passes-title"
      data-testid="gate-passes"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 print:hidden"
    >
      <div className="flex flex-col gap-1">
        <h2 id="gate-passes-title" className="text-lg">
          Gate scanner
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          One pass per gate. Open it on the door phone by scanning its QR, or type the code at{' '}
          <span className="font-mono">{base.replace(/^https?:\/\//, '')}/door</span>. Before{' '}
          {formatDhakaShort(window.validFrom)} scans are practice — nothing is checked in. Passes
          stop working at {formatDhakaShort(window.validUntil)}.
        </p>
      </div>

      {canCreate ? (
        <NewGatePassForm create={createGatePassAction.bind(null, event.id)} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {event.status === 'draft'
            ? 'The event is unpublished: its gate passes do not work, and new ones need it published again.'
            : event.status === 'archived'
              ? `Archived — existing passes keep working until ${formatDhakaShort(window.validUntil)}; new passes need a published event.`
              : 'This event is over — no new gate passes.'}
        </p>
      )}

      {rows.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => {
            const qr = qrs.get(r.pass.id);
            const state = STATE[r.state];
            return (
              <li
                key={r.pass.id}
                data-testid="gate-pass-row"
                className="flex flex-col gap-3 px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {r.pass.label}
                      <Chip tone={state.tone} size="sm">
                        {state.label}
                      </Chip>
                    </p>
                    <p className="text-[13px] text-muted-foreground tabular">
                      {r.scans} {r.scans === 1 ? 'scan' : 'scans'} · {r.admitted} admitted ·{' '}
                      {r.searchAdmits} by name
                      {r.offlineScans > 0 ? ` · ${r.offlineScans} offline` : ''} · last scan{' '}
                      {r.lastScanAt ? formatDhakaClock(r.lastScanAt) : '—'} · made by{' '}
                      {r.pass.createdBy}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {qr ? (
                      <RevokeGatePassButton
                        label={r.pass.label}
                        revoke={revokeGatePassAction.bind(null, event.id, r.pass.id)}
                      />
                    ) : null}
                    {qr || (r.state === 'revoked' && r.admitted > 0) ? (
                      <RevokeAndUndoButton
                        label={r.pass.label}
                        admitted={r.admitted}
                        revokeAndUndo={revokeAndUndoGatePassAction.bind(null, event.id, r.pass.id)}
                      />
                    ) : null}
                  </div>
                </div>

                {qr ? (
                  <details open={openPassId === r.pass.id} className="group">
                    <summary className="w-fit cursor-pointer text-sm font-semibold underline underline-offset-2">
                      Show the pass
                    </summary>
                    <div className="mt-3 flex flex-wrap gap-6">
                      <div
                        aria-label={`QR code of the ${r.pass.label} gate pass link`}
                        role="img"
                        className="size-55 shrink-0 rounded-lg border border-border bg-white p-2 [&_svg]:size-full"
                        dangerouslySetInnerHTML={{ __html: qr }}
                      />
                      <div className="flex max-w-md flex-col gap-3 text-sm">
                        <div>
                          <p className="text-muted-foreground">Gate code</p>
                          <p
                            data-testid="gate-pass-code"
                            className="font-mono text-2xl font-semibold tracking-wider"
                          >
                            {formatPassCode(r.pass.code)}
                          </p>
                        </div>
                        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                          <li>
                            Scan the QR with the door phone&apos;s camera, and open it in Safari or
                            Chrome (not inside Messenger).
                          </li>
                          <li>
                            iPhone: allow the camera, and set Auto-Lock to Never for the night.
                          </li>
                          <li>Bring a power bank — the camera runs all evening.</li>
                          <li>
                            Open the pass where there is signal: the phone downloads the ticket
                            list, so it keeps scanning if the signal drops, and sends those scans
                            when it is back. Once opened with signal, the page also reloads
                            without it.
                          </li>
                          <li>
                            Treat the code like a key: anyone with it can check tickets in at this
                            gate.
                          </li>
                        </ul>
                      </div>
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {rows.length > 0 ? <OfflineConflicts eventId={event.id} /> : null}
    </section>
  );
}
