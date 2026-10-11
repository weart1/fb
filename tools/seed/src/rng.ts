/** Deterministic PRNG (mulberry32) so the seed produces the same dataset every run. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  int(min: number, max: number): number {
    return Math.floor(min + this.next() * (max - min + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
    const total = items.reduce((a, [, w]) => a + w, 0);
    let x = this.next() * total;
    for (const [v, w] of items) {
      x -= w;
      if (x < 0) return v;
    }
    return items[items.length - 1]![0];
  }
  normal(): number {
    let u = 0;
    while (u === 0) u = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
  /** log-normal with the given median and spread (sigma of the underlying normal) */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal());
  }
  hex(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(this.next() * 16).toString(16);
    return s;
  }
  /** UUIDv7 with an embedded timestamp, like the SDK generates */
  uuidv7(ts: number): string {
    const h = Math.floor(ts).toString(16).padStart(12, '0');
    const r = this.hex(20);
    const variant = (8 + Math.floor(this.next() * 4)).toString(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${r.slice(0, 3)}-${variant}${r.slice(3, 6)}-${r.slice(6, 18)}`;
  }
}
