// PRD §11.2 — local (per-worker-node) semaphore capping concurrent initial
// syncs at ≤5. Each worker process owns its own 5-slot pool; horizontal
// scaling adds worker nodes, not more slots per node.
//
// Contract: `acquire()` resolves with a `release` function. Calling
// `release` more than once is a no-op (idempotent) so callers can wrap it
// in a `try/finally` without worrying about double-release inflating the
// pool.

export interface LocalSemaphore {
  acquire(): Promise<() => void>;
}

export function createLocalSemaphore(cap: number): LocalSemaphore {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new Error(`semaphore cap must be positive integer, got ${cap}`);
  }
  let held = 0;
  const waiters: Array<() => void> = [];

  function next() {
    if (held >= cap) return;
    const w = waiters.shift();
    if (w) {
      held += 1;
      w();
    }
  }

  return {
    acquire(): Promise<() => void> {
      return new Promise((resolve) => {
        const grant = () => {
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            held -= 1;
            next();
          };
          resolve(release);
        };
        if (held < cap) {
          held += 1;
          grant();
        } else {
          waiters.push(grant);
        }
      });
    },
  };
}
