import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    '.next-build/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Personal working notes (git-ignored) may contain third-party exports.
    'notes/**',
    // Build artifacts (the esbuild worker bundle) and local email previews.
    'dist/**',
    'tmp/**',
  ]),
]);

export default eslintConfig;
