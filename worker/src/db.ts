// Tiny D1 helpers. Keeping this thin so route files stay readable.

export function nowMs() {
  return Date.now();
}

export function newId(prefix = "id"): string {
  // ULID-lite: time + 80 random bits, base36
  const t = Date.now().toString(36);
  const r = crypto.getRandomValues(new Uint8Array(10));
  let s = "";
  for (const b of r) s += b.toString(36).padStart(2, "0");
  return `${prefix}_${t}${s}`.slice(0, 32);
}

export async function one<T = unknown>(stmt: D1PreparedStatement): Promise<T | null> {
  const r = await stmt.first<T>();
  return r ?? null;
}

export async function all<T = unknown>(stmt: D1PreparedStatement): Promise<T[]> {
  const r = await stmt.all<T>();
  return r.results ?? [];
}
