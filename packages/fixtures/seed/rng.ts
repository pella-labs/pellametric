/**
 * Deterministic LCG. Same parameters as `packages/schema/scripts/seed.ts` so
 * the perf seed stays reproducible across CI runs — the M2 gate compares
 * p95 / p99 numbers over time, and a wobbling fixture would muddy the signal.
 */
export class Rng {
  private state: number;

  constructor(seed = 0xdecaf) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state;
  }

  int(max: number): number {
    return this.next() % max;
  }

  /** Uniform [0, 1). */
  float(): number {
    return this.next() / 0x7fffffff;
  }

  /**
   * Box–Muller standard normal. Lazy cache of the second draw.
   */
  private spare: number | null = null;
  normal(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.float();
    while (v === 0) v = this.float();
    const mag = Math.sqrt(-2 * Math.log(u));
    this.spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  }

  /** Lognormal for cost/duration tails: positive, right-skewed. */
  lognormal(mu: number, sigma: number, cap: number): number {
    const v = Math.exp(mu + sigma * this.normal());
    return Math.min(v, cap);
  }

  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)] as T;
  }

  /**
   * Deterministic UUID v4-shaped string from the LCG. We don't need RFC 4122
   * crypto randomness for seeded fixtures — we DO need reproducibility, which
   * `crypto.randomUUID()` does not give us.
   */
  uuid(): string {
    const hex: string[] = [];
    for (let i = 0; i < 16; i++) {
      hex.push(this.int(256).toString(16).padStart(2, "0"));
    }
    // v4 variant nibbles
    hex[6] = `4${hex[6]?.slice(1)}`;
    const v = (Number.parseInt(hex[8]!, 16) & 0x3f) | 0x80;
    hex[8] = v.toString(16).padStart(2, "0");
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10, 16).join(""),
    ].join("-");
  }
}
