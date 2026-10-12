import { notFound } from 'next/navigation';
import { ogImage } from '@/components/og-card';
import { source } from '@/lib/source';

// One share image per page, written into the static export at build time.
export const dynamic = 'force-static';

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: [...page.slugs, 'image.png'] }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();
  return ogImage({
    label: page.data.label,
    title: page.data.title,
    description: page.data.description,
  });
}
