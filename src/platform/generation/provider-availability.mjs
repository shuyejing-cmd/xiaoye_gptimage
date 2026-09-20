export function createProviderAvailability({ providerName, provider, ttlMs = 15_000, now = Date.now }) {
  let cached = null;
  let pending = null;

  async function refresh() {
    const checkedAt = now();
    let available = true;
    try {
      if (provider?.healthCheck) await provider.healthCheck();
    } catch {
      available = false;
    }
    cached = { available, checkedAt, expiresAt: checkedAt + ttlMs };
    return available;
  }

  return {
    async check() {
      if (cached && now() < cached.expiresAt) return cached.available;
      if (!pending) pending = refresh().finally(() => { pending = null; });
      return pending;
    },
    snapshot() {
      return {
        provider: providerName,
        available: cached?.available ?? null,
        checked_at: cached ? new Date(cached.checkedAt).toISOString() : null
      };
    }
  };
}
