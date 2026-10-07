import { execFileSync } from 'node:child_process';
import { createMDX } from 'fumadocs-mdx/next';

// Links refer to the checkout being built, including CI and Pages previews.
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const withMDX = createMDX();
export default withMDX({
  output: 'export',
  trailingSlash: true,
  env: { DOCS_SOURCE_REVISION: revision },
});
