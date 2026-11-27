/**
 * Runs `fn` with `setTimeout` firing on the next tick, recording each
 * requested delay. Restored when `fn` settles; bun runs test files one at a
 * time, so nothing else sees the patched timer.
 */
export async function withFakeTimers<T>(
  fn: (delays: number[]) => Promise<T>
): Promise<T> {
  const original = globalThis.setTimeout;
  const delays: number[] = [];
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    delays.push(ms ?? 0);
    return original(callback, 0, ...args);
  }) as typeof setTimeout;
  try {
    return await fn(delays);
  } finally {
    globalThis.setTimeout = original;
  }
}
