import { jsonLdScript } from '@/lib/structured-data';

/**
 * ADR-042: schema.org data for search engines and AI assistants. The one
 * other place raw markup is written (besides RichText): the value is JSON
 * built by src/lib/structured-data.ts, and `jsonLdScript` escapes `<`, so
 * nothing an admin types can end the script element.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }} />
  );
}
