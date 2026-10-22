// Per-database caches (DEK, payee token frequencies, disk usage) must be
// dropped whenever the open database changes: lock, profile switch, restore.
// Next.js loads modules in several bundles, so each bundle's copy of a cache
// registers its own resetter here, and the registry itself lives on globalThis
// so one notify reaches all of them. No imports: this is called from @/db.

type Resetter = () => void;
const g = globalThis as unknown as { __dbContextResetters?: Set<Resetter> };
const resetters: Set<Resetter> = (g.__dbContextResetters ??= new Set());

export function onDbContextChange(fn: Resetter): void {
  resetters.add(fn);
}

export function notifyDbContextChange(): void {
  for (const fn of resetters) {
    try {
      fn();
    } catch (e) {
      console.error("[db-context] resetter failed:", e);
    }
  }
}
