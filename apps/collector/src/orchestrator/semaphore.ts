export class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly cap: number) {
    if (cap < 1) throw new Error("Semaphore cap must be >= 1");
  }

  get activeCount(): number {
    return this.active;
  }

  async acquire(): Promise<void> {
    if (this.active < this.cap) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
  }

  release(): void {
    if (this.active === 0) throw new Error("release without prior acquire");
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}
