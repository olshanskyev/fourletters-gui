// Cross-tab serialization for the Double Ratchet. Each high-level Signal operation (encrypt,
// decrypt, session setup) runs inside a per-user Web Lock so two tabs never advance the same
// ratchet/prekey state concurrently

interface LockManagerLike {
  request<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

/** Run fn while holding the exclusive Signal lock for userId; do NOT nest calls (not reentrant). */
export async function withSignalLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator & { locks?: LockManagerLike })?.locks;
  if (!locks?.request) {
    return fn();
  }
  return locks.request(`fourletters:signal:${userId}`, () => fn());
}
