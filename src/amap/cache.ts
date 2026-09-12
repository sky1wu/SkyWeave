export class TtlCache<T> {
  private readonly values = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 1000,
    private readonly now = Date.now,
  ) {}

  get(key: string): T | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.values.delete(key);
      return undefined;
    }
    this.values.delete(key);
    this.values.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) return;
    this.values.delete(key);
    // Prune expired entries before evicting live ones.
    for (const [candidate, entry] of this.values) {
      if (entry.expiresAt <= this.now()) this.values.delete(candidate);
    }
    if (this.values.size >= this.maxEntries) {
      const oldest = this.values.keys().next().value;
      if (oldest !== undefined) this.values.delete(oldest);
    }
    this.values.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  get size(): number {
    return this.values.size;
  }
}
