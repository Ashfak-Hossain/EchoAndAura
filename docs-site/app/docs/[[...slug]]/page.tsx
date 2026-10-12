import { SOURCE_URL } from '@/lib/layout.shared';
import { source } from '@/lib/source';
import { DocsPage, DocsBody, DocsTitle, DocsDescription } from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/mdx-components';
import type { Metadata } from 'next';

export function generateStaticParams() {
  return source.generateParams();
}
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const image = `/og/docs/${[...page.slugs, 'image.png'].join('/')}`;
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: page.url },
    openGraph: {
      siteName: 'Echo & Aura developer docs',
      type: 'article',
      url: page.url,
      images: image,
    },
    twitter: { card: 'summary_large_image', images: image },
  };
}

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const Content = page.data.body;
  const revision = process.env.DOCS_SOURCE_REVISION ?? '';
  return (
    // One label above the title, from frontmatter; the breadcrumb would repeat it.
    <DocsPage toc={page.data.toc} breadcrumb={{ enabled: false }}>
      <p className="eyebrow">{page.data.label}</p>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <Content components={getMDXComponents()} />
      </DocsBody>
      <p className="source-revision">
        Source revision: <code>{revision.slice(0, 7)}</code> ·{' '}
        <a href={`${SOURCE_URL}/blob/${revision}/docs-site/content/docs/${page.path}`}>
          View this page&apos;s source
        </a>
      </p>
    </DocsPage>
  );
}
