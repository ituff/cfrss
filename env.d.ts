// Augment the Cloudflare namespace's Env interface so that `import { env } from "cloudflare:test"`
// knows about our Worker's bindings (DB, ENCRYPTION_KEY, AUTH_TOKEN).
// See: https://developers.cloudflare.com/workers/languages/typescript/#generate-types
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ENCRYPTION_KEY: string;
    AUTH_TOKEN: string;
  }
}
