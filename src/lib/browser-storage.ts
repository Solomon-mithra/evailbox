/** Preserve existing browser data when a product storage key changes. */
export function migrateStoredValue(key: string, legacyKey: string): string | null {
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;
    const previous = localStorage.getItem(legacyKey);
    if (previous !== null) {
      try {
        localStorage.setItem(key, previous);
        localStorage.removeItem(legacyKey);
      } catch {
        // A blocked write must not hide readable, existing data.
      }
    }
    return previous;
  } catch {
    return null;
  }
}
