import { attachDatabasePool } from "@vercel/functions";
import { Pool, type PoolClient } from "pg";

// Construct the pool lazily so builds and static pages do not require a live
// database. Neon recommends its pooled URL for app requests.
const databaseGlobal = globalThis as typeof globalThis & { __mysteryMatchPool?: Pool };

export function getDb(): Pool {
  if (databaseGlobal.__mysteryMatchPool) return databaseGlobal.__mysteryMatchPool;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required for persistent storage.");
  const pool = new Pool({ connectionString, enableChannelBinding: true, max: 5, idleTimeoutMillis: 5000 });
  if (process.env.VERCEL) attachDatabasePool(pool);
  databaseGlobal.__mysteryMatchPool = pool;
  return pool;
}

export async function withTransaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    client.release();
  }
}

/** Serialize mutations involving the same people in a consistent order. */
export async function lockProfiles(client: PoolClient, userIds: string[]): Promise<void> {
  await client.query(
    'SELECT user_id FROM profiles WHERE user_id = ANY($1::text[]) ORDER BY user_id COLLATE "C" FOR UPDATE',
    [[...new Set(userIds)]],
  );
}
