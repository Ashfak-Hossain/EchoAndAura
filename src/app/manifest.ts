import type { MetadataRoute } from 'next';
import { BRAND_DARK, BRAND_LIGHT } from '@/lib/brand/og';
import { HOME_TAGLINE, SITE_NAME } from '@/lib/seo';

// ADR-042: name, colours and icon for "Add to Home Screen" and browsers. Not
// an app: the door scanner has its own service worker (ADR-035).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: HOME_TAGLINE,
    start_url: '/',
    display: 'browser',
    background_color: BRAND_LIGHT,
    theme_color: BRAND_DARK,
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
