import { headers } from 'next/headers';
import { BEACON_SRC, beaconConfig, nonceFromCsp, webAnalyticsToken } from '@/lib/web-analytics';

/**
 * ADR-077, ADR-079: Cloudflare's beacon. Rendered only by the (measured)
 * root layout, so it is in the HTML the server sends for a measured page
 * and in no other document. The nonce is this request's, read from the
 * policy the proxy set. Nothing when the token is unset (dev, e2e) or
 * there is no policy to take a nonce from.
 */
export async function WebAnalytics() {
  const token = webAnalyticsToken(process.env.CF_WEB_ANALYTICS_TOKEN);
  const nonce = nonceFromCsp((await headers()).get('content-security-policy'));
  if (!token || !nonce) return null;
  return <script defer src={BEACON_SRC} data-cf-beacon={beaconConfig(token)} nonce={nonce} />;
}
