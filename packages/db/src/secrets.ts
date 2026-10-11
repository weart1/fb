import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for integration credentials at rest (ConversionDestination.credentials, ad platform tokens).
 * Key = sha256(APP_SECRET). Format: base64(iv[12] | tag[16] | ciphertext).
 */
function key(secret: string): Buffer {
  if (!secret || secret.length < 32) throw new Error('APP_SECRET must be at least 32 characters');
  return createHash('sha256').update(secret).digest();
}

export function encryptJson(value: unknown, secret: string = process.env.APP_SECRET ?? ''): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decryptJson<T>(payload: string, secret: string = process.env.APP_SECRET ?? ''): T {
  const buf = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  const pt = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
  return JSON.parse(pt.toString('utf8')) as T;
}
