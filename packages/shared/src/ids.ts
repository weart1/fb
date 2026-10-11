/** Deterministic 32-bit FNV-1a hash, used for experiment bucketing (same in SDK and server). */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Bucket in [0, 1) for a (salt, id) pair. */
export function bucket(salt: string, id: string): number {
  return fnv1a(`${salt}:${id}`) / 0x100000000;
}
