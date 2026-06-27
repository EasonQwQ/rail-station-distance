function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 串行队列 + 最小请求间隔，保证不超过 maxQps */
export class RateLimiter {
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(maxQps: number) {
    const qps = Math.max(1, maxQps);
    this.minIntervalMs = Math.ceil(1000 / qps);
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const elapsed = Date.now() - this.lastRequestAt;
      if (elapsed < this.minIntervalMs) {
        await sleep(this.minIntervalMs - elapsed);
      }
      this.lastRequestAt = Date.now();
      return fn();
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}
