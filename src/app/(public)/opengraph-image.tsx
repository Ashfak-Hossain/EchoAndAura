import { ImageResponse } from 'next/og';
import { BRAND_DARK, BRAND_LIGHT, brandFonts } from '@/lib/brand/og';
import { HOME_TAGLINE, SITE_NAME } from '@/lib/seo';

// ADR-042: the share card for every page without an event cover (About,
// FAQ, policies, the home page between events). Static: built once.
export const dynamic = 'force-static';
export const alt = `${SITE_NAME}: live events in Dhaka`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 80,
        background: BRAND_DARK,
        color: BRAND_LIGHT,
        fontFamily: 'Noto Sans',
      }}
    >
      <div style={{ display: 'flex', fontSize: 30, opacity: 0.7 }}>Live events · Dhaka</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', fontSize: 120, fontWeight: 700, letterSpacing: -4 }}>
          {SITE_NAME}
        </div>
        <div style={{ display: 'flex', fontSize: 38, lineHeight: 1.35, maxWidth: 980 }}>
          {HOME_TAGLINE}
        </div>
      </div>
      <div style={{ display: 'flex', fontSize: 30, opacity: 0.7 }}>echoandaura.com</div>
    </div>,
    { ...size, fonts: await brandFonts() },
  );
}
