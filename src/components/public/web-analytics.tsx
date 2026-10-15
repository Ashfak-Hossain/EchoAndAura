import { headers } from 'next/headers';
import {
  BEACON_SRC,
  WEB_ANALYTICS_HEADER,
  beaconConfig,
  nonceFromCsp,
  webAnalyticsToken,
} from '@/lib/web-analytics';
import { WebAnalyticsGuard } from './web-analytics-guard';

/**
 * ADR-077: Cloudflare's beacon, on the pages the proxy measures. Rendered
 * by the public layout, so it is in the HTML the server sends; the nonce is
 * this request's, read from the policy the proxy set. Always with the guard
 * that keeps the beacon off unmeasured pages. Nothing when the page is not
 * measured or the token is unset (dev, e2e).
 */
export async function WebAnalytics() {
  const h = await headers();
  // The token is ours, from env; the header only says the proxy measured
  // this page. A path the proxy skips (`/api/nope` renders the not-found
  // page in this layout) keeps the visitor's own headers, so the header
  // must carry exactly our token.
  const token = webAnalyticsToken(process.env.CF_WEB_ANALYTICS_TOKEN);
  const nonce = nonceFromCsp(h.get('content-security-policy'));
  if (!token || h.get(WEB_ANALYTICS_HEADER) !== token || !nonce) return null;
  return (
    <>
      <script defer src={BEACON_SRC} data-cf-beacon={beaconConfig(token)} nonce={nonce} />
      <WebAnalyticsGuard />
    </>
  );
}
