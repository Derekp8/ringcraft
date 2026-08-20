export interface AutoSyncHandle {
  /** Starts (or restarts) the periodic sync loop; safe to call repeatedly. */
  start(): void;
  /** Stops the loop; an already-running sync is allowed to finish. */
  stop(): void;
  /** True while the loop is active. */
  readonly active: boolean;
}

export interface AutoSyncOptions {
  /** Fire one sync immediately on `start()` (default false). */
  syncNow?: boolean;
  /** Receives rejections from a periodic sync; the loop keeps running. */
  onError?: (error: unknown) => void;
}

/**
 * Drives a background sync loop: calls `sync` every `intervalMs`, never
 * overlapping runs, and keeps going after failures. `start()` is idempotent;
 * `stop()` cancels the timer (an in-flight sync still completes). Deliberately
 * DOM-free so it is unit-testable with fake timers and reusable outside the
 * React tree.
 */
export function createAutoSyncTimer(sync: () => Promise<void>, intervalMs: number, options: AutoSyncOptions = {}): AutoSyncHandle {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let running = false;

  async function run(): Promise<void> {
    if (inFlight || !running) return;
    inFlight = true;
    try {
      await sync();
    } catch (error) {
      options.onError?.(error);
    } finally {
      inFlight = false;
    }
  }

  return {
    get active() {
      return running;
    },
    start() {
      if (running) return;
      running = true;
      if (options.syncNow) void run();
      timer = setInterval(() => void run(), intervalMs);
    },
    stop() {
      running = false;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
