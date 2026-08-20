import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutoSyncTimer } from "../src/ui/auto-sync";

describe("createAutoSyncTimer (scheduled save auto-sync)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is inert until started, then fires on the interval", async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const handle = createAutoSyncTimer(sync, 1_000);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sync).not.toHaveBeenCalled();
    expect(handle.active).toBe(false);

    handle.start();
    expect(handle.active).toBe(true);
    expect(sync).not.toHaveBeenCalled(); // no syncNow, so the first tick only
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("fires one sync immediately when syncNow is set, and start() is idempotent", async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const handle = createAutoSyncTimer(sync, 1_000, { syncNow: true });
    handle.start();
    handle.start(); // second start must not double the immediate fire
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("stop() cancels the loop and can be restarted", async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const handle = createAutoSyncTimer(sync, 1_000);
    handle.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync).toHaveBeenCalledTimes(1);
    handle.stop();
    expect(handle.active).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sync).toHaveBeenCalledTimes(1);

    handle.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("never overlaps runs: a slow in-flight sync skips the ticks that land during it", async () => {
    let resolveSlow: (value: void) => void = () => undefined;
    const sync = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { resolveSlow = resolve; }));
    const handle = createAutoSyncTimer(sync, 1_000, { syncNow: true });
    handle.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);
    // Two ticks land while the first sync is still in flight: both are skipped.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sync).toHaveBeenCalledTimes(1);
    // Once it settles, the next tick runs again.
    resolveSlow();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("reports failures to onError and keeps the loop running", async () => {
    const onError = vi.fn();
    const sync = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const handle = createAutoSyncTimer(sync, 1_000, { onError });
    handle.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    // The loop survives the failure and fires on the next interval.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("stop() during an in-flight sync lets the sync settle without a new timer", async () => {
    let resolveSlow: (value: void) => void = () => undefined;
    const sync = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { resolveSlow = resolve; }));
    const handle = createAutoSyncTimer(sync, 1_000, { syncNow: true });
    handle.start();
    await vi.advanceTimersByTimeAsync(0);
    handle.stop();
    resolveSlow();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(handle.active).toBe(false);
  });
});
