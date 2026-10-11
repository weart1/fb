import { createHash } from 'node:crypto';

export const sha256 = (v: string): string => createHash('sha256').update(v.trim().toLowerCase()).digest('hex');
/** Pass through values that are already SHA-256 hex, hash anything else. */
export const ensureHashed = (v: string): string => (/^[a-f0-9]{64}$/.test(v) ? v : sha256(v));
