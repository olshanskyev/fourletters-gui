/**
 * Options for a Stale-While-Revalidate read against a device-local cache.
 *
 * @typeParam T - The cached record type; must carry an `updatedAt` epoch-ms timestamp.
 */
export interface SwrOptions<T extends { updatedAt: number }> {
  /** Read the locally cached record, or `undefined` if this device has none. */
  readCache: () => Promise<T | undefined>;
  /** Fetch from the source of truth and persist it locally, returning the fresh record. */
  revalidate: () => Promise<T>;
  /** Maximum age, in ms, before a cached record is considered stale. */
  ttlMs: number;
  /** Bypass the cache and always revalidate. */
  forceRefresh?: boolean;
  /** Invoked when a background (non-blocking) revalidation rejects. */
  onBackgroundError?: (err: unknown) => void;
}

/**
 * Stale-While-Revalidate read: return the cached record immediately (or `undefined` when nothing is
 * cached) and revalidate in the background when the cache is missing or stale.
 */
export async function staleWhileRevalidate<T extends { updatedAt: number }>(
  opts: SwrOptions<T>
): Promise<T | undefined> {
  const cached = await opts.readCache();

  // Forced refresh: the caller explicitly wants a fresh value, so fetch and wait for it.
  if (opts.forceRefresh) {
    return opts.revalidate();
  }

  const isStale = !cached || Date.now() - cached.updatedAt > opts.ttlMs;
  if (!isStale) {
    return cached;
  }

  // Missing or stale: serve whatever we have now and revalidate out-of-band.
  setTimeout(() => {
    opts.revalidate().catch(opts.onBackgroundError ?? (() => undefined));
  }, 0);

  return cached;
}
