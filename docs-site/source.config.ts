import { defineConfig, defineDocs, frontmatterSchema } from 'fumadocs-mdx/config';
import { z } from 'zod';
import { transformerTwoslash } from 'fumadocs-twoslash';
import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins';
import { remarkSourceExcerpts } from './lib/source-excerpts';

// Only this explicitly authored public collection enters pages and search.
// `label` is the small line above each title ("Guided tour", "Concept").
export const docs = defineDocs({
  dir: 'content/docs',
  docs: { schema: frontmatterSchema.extend({ label: z.string().min(1) }) },
});
export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkSourceExcerpts],
    rehypeCodeOptions: {
      themes: { light: 'github-light', dark: 'github-dark' },
      transformers: [...(rehypeCodeDefaultOptions.transformers ?? []), transformerTwoslash()],
      langs: ['js', 'jsx', 'ts', 'tsx'],
    },
  },
});
