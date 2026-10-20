const ttlMs = 30_000;

/** Non-secret display status only. Execution continues to resolve its own credentials. */
export function createAuthStatus(
  read: (providerId: string) => Promise<boolean> | boolean,
  revision: () => string,
  now: () => number = () => performance.now(),
) {
  type Cached = { expiresAt: number; result: Promise<boolean> };
  const entries = new Map<string, Cached>();
  let currentRevision = revision();
  return async function status(providerId: string | undefined): Promise<boolean> {
    if (!providerId) return false;
    for (;;) {
      const captured = revision();
      if (captured !== currentRevision) {
        entries.clear();
        currentRevision = captured;
      }
      let cached = entries.get(providerId);
      if (!cached || cached.expiresAt <= now()) {
        const entry: Cached = {
          expiresAt: Infinity,
          result: Promise.resolve().then(() => read(providerId)),
        };
        entries.set(providerId, entry);
        entry.result = entry.result.then(
          (configured) => {
            entry.expiresAt = now() + ttlMs;
            return configured;
          },
          (error: unknown) => {
            if (entries.get(providerId) === entry) entries.delete(providerId);
            throw error;
          },
        );
        cached = entry;
      }
      try {
        const configured = await cached.result;
        // A credential/configuration write can finish while the old read is in flight.
        if (captured === revision()) return configured;
      } catch (error) {
        if (captured === revision()) throw error;
      }
    }
  };
}
