import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { transformerTwoslash } from 'fumadocs-twoslash';
import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins';
import { remarkSourceExcerpts } from './lib/source-excerpts';

// Only this explicitly authored public collection enters pages and search.
export const docs = defineDocs({ dir: 'content/docs' });
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
