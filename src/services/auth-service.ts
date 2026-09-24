/**
 * Auth Service — password (access token) management.
 *
 * The Worker's AUTH_TOKEN secret cannot be written at runtime, so a password
 * changed from the UI is persisted to the D1 `config` table (key: 'auth_hash')
 * as a PBKDF2-SHA256 hash. The env AUTH_TOKEN remains the bootstrap credential:
 * until a custom password is set, the env token is accepted; once set, only the
 * stored hash is valid. Removing it restores the env token.
 */

const AUTH_HASH_KEY = 'auth_hash';

/** PBKDF2 iteration count — tuned to stay well inside the Workers CPU budget. */
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Derive a PBKDF2-SHA256 hash of the password with the given salt.
 * Returns a base64 string.
 */
async function derivePasswordHash(password: string, salt: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    KEY_BITS,
  );

  return toBase64(new Uint8Array(bits));
}

/** Constant-time string comparison to avoid leaking length/prefix via timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Hash a new password into a storable record string: `pbkdf2$<iterations>$<salt>$<hash>`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derivePasswordHash(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${hash}`;
}

/**
 * Verify a plaintext password against a stored record produced by `hashPassword`.
 * Returns false for malformed records rather than throwing.
 */
export async function verifyPassword(password: string, record: string): Promise<boolean> {
  try {
    const parts = record.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

    const iterations = Number.parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;

    const salt = fromBase64(parts[2]);
    const expected = parts[3];

    const encoder = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt as unknown as BufferSource,
        iterations,
        hash: 'SHA-256',
      },
      baseKey,
      KEY_BITS,
    );

    return safeEqual(toBase64(new Uint8Array(bits)), expected);
  } catch {
    return false;
  }
}

/** Read the stored password record, or null when no custom password is set. */
export async function getStoredPasswordHash(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM config WHERE key = ?')
    .bind(AUTH_HASH_KEY)
    .first<{ value: string }>();
  return row?.value ?? null;
}

/** Persist a new password record (upsert). */
export async function setStoredPasswordHash(db: D1Database, record: string): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))')
    .bind(AUTH_HASH_KEY, record)
    .run();
}

/** Remove the custom password, restoring the env AUTH_TOKEN as the credential. */
export async function clearStoredPasswordHash(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM config WHERE key = ?').bind(AUTH_HASH_KEY).run();
}

/**
 * Validate an incoming bearer token.
 * Prefers the stored password hash when present; otherwise compares against
 * the env bootstrap token.
 */
export async function validateAuthToken(
  db: D1Database,
  envToken: string | undefined,
  candidate: string,
): Promise<boolean> {
  const stored = await getStoredPasswordHash(db);
  if (stored) {
    return verifyPassword(candidate, stored);
  }
  if (!envToken) return false;
  return safeEqual(candidate, envToken);
}

/** Minimum accepted password length. */
export const MIN_PASSWORD_LENGTH = 6;
