import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { diagnosticsEnabled } from '@/lib/error-tracking/synthetic';
import { DiagnosticsPanel } from './diagnostics-panel';

export const metadata: Metadata = { title: 'Diagnostics' };
export const dynamic = 'force-dynamic';

// docs/ERROR-TRACKING.md: the activation proof. Absent unless switched on.
export default function DiagnosticsPage() {
  if (!diagnosticsEnabled()) notFound();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Error-tracking diagnostics"
        subtitle="Each check raises a synthetic error. No order, ticket or buyer is touched."
      />
      <DiagnosticsPanel />
    </div>
  );
}
