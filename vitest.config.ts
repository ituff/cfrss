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
  },
});
