import { ogImage } from '@/components/og-card';

// The share image for the home page and anything without its own.
export const dynamic = 'force-static';

export function GET() {
  return ogImage({
    label: 'Developer documentation',
    title: 'A real system. The reasoning behind it.',
    description: 'How a ticket reservation, a manual payment, and a background job fit together.',
  });
}
