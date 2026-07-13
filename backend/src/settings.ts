import { pool } from "./db";

const cache = new Map<string, string>();
let loaded = false;

async function loadAll(): Promise<void> {
  const result = await pool.query("SELECT key, value FROM app_settings");
  cache.clear();
  for (const row of result.rows) {
    if (row.value != null) cache.set(row.key, row.value);
  }
  loaded = true;
}

export async function getSetting(key: string, envFallback?: string): Promise<string | undefined> {
  if (!loaded) await loadAll();
  if (cache.has(key)) return cache.get(key);
  return envFallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
  cache.set(key, value);
}

export async function getAllSettingsRaw(): Promise<Record<string, string>> {
  if (!loaded) await loadAll();
  return Object.fromEntries(cache);
}
