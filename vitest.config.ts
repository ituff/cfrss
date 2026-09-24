import { defineConfig } from 'vitest/config';
import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-pool-workers';

const poolOptions = {
  wrangler: { configPath: './wrangler.toml' },
  miniflare: {
    d1Databases: ['DB'],
  },
};

export default defineConfig({
  plugins: [
    cloudflareTest(poolOptions),
  ],
  test: {
    pool: cloudflarePool(poolOptions),
    setupFiles: ['./test/setup.ts'],
    // Scope collection to the real suite. Without this, vitest's default
    // `**/*.{test,spec}.?(c|m)[jt]s?(x)` glob also picks up stray copies of the
    // repo that local tooling may park in hidden working directories, which
    // produce bogus "no test suite found" / unresolvable-import failures.
    include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
});
