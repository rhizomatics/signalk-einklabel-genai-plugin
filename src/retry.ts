/**
 * Retries `fn` up to `attempts` times (including the first try), returning on the first success -
 * mirrors the core plugin's own `withRetries` (`src/devices/bleDiscovery.ts`), duplicated here rather
 * than imported since that one isn't part of the core plugin's public `esl` export surface.
 */
export async function withRetries<T>(attempts: number, fn: (attempt: number) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
