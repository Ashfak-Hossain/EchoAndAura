import { defineConfig, defineDocs } from 'fumadocs-mdx/config';

// Only this explicitly authored public collection enters pages and search.
export const docs = defineDocs({ dir: 'content/docs' });
export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
