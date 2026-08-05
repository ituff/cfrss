/**
 * Encryption/decryption utilities for API keys stored in D1.
 * Uses AES-GCM (authenticated encryption) via the Web Crypto API,
 * which is natively available in Cloudflare Workers.
 *
 * Encrypted format: base64(iv[12 bytes] + ciphertext)
 */

const IV_LENGTH = 12; // 96-bit IV for AES-GCM
const ALGORITHM = 'AES-GCM';

/**
 * Derives an AES-GCM CryptoKey from a plain string (the ENCRYPTION_KEY env var).
 * Uses SHA-256 to hash the key string into a 256-bit key suitable for AES.
 */
async function deriveKey(keyString: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString);

  // Hash the key string to get exactly 256 bits
  const hashBuffer = await crypto.subtle.digest('SHA-256', keyData);

  return crypto.subtle.importKey(
    'raw',
    hashBuffer,
    { name: ALGORITHM },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a plaintext string using AES-GCM.
 * Returns a base64-encoded string containing the IV prepended to the ciphertext.
 *
 * @param plaintext - The string to encrypt (e.g., an API key)
 * @param key - The encryption key string (from ENCRYPTION_KEY env var)
 * @returns base64-encoded string of (iv + ciphertext)
 * @throws Error if encryption fails
 */
export async function encrypt(plaintext: string, key: string): Promise<string> {
  if (!plaintext) {
    throw new Error('Cannot encrypt empty plaintext');
  }
  if (!key) {
    throw new Error('Encryption key must not be empty');
  }

  const cryptoKey = await deriveKey(key);
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // Generate a random 12-byte IV for each encryption
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    cryptoKey,
    data
  );

  // Combine IV + ciphertext into a single buffer
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);

  // Encode as base64 for storage in a TEXT column
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts a base64-encoded ciphertext string that was encrypted with `encrypt()`.
 *
 * @param ciphertext - The base64-encoded string (iv + encrypted data)
 * @param key - The encryption key string (must match the key used for encryption)
 * @returns The original plaintext string
 * @throws Error if decryption fails (wrong key, corrupted data, etc.)
 */
export async function decrypt(ciphertext: string, key: string): Promise<string> {
  if (!ciphertext) {
    throw new Error('Cannot decrypt empty ciphertext');
  }
  if (!key) {
    throw new Error('Encryption key must not be empty');
  }

  let combined: Uint8Array;
  try {
    const binaryString = atob(ciphertext);
    combined = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      combined[i] = binaryString.charCodeAt(i);
    }
  } catch {
    throw new Error('Invalid ciphertext: not valid base64');
  }

  if (combined.length < IV_LENGTH + 1) {
    throw new Error('Invalid ciphertext: data too short');
  }

  // Extract IV and encrypted data
  const iv = combined.slice(0, IV_LENGTH);
  const encryptedData = combined.slice(IV_LENGTH);

  const cryptoKey = await deriveKey(key);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      cryptoKey,
      encryptedData
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch {
    throw new Error('Decryption failed: invalid key or corrupted data');
  }
}
