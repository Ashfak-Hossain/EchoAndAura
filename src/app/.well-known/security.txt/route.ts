import { buildSecurityTxt } from '@/lib/crawl';
import { siteUrl } from '@/lib/env.public';

// RFC 9116 (ADR-042). Per request: SITE_URL, and a rolling Expires.
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(buildSecurityTxt(siteUrl(), new Date()), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
