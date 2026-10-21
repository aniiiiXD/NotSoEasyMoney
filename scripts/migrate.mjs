import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED is required for migrations.");
const pool = new pg.Pool({ connectionString, enableChannelBinding: true, max: 1 });
const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(1576883541)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  for (const name of (await readdir(migrationDirectory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()) {
    const sql = await readFile(join(migrationDirectory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const old = await client.query("SELECT checksum FROM schema_migrations WHERE name = $1", [name]);
    if (old.rowCount) {
      if (old.rows[0].checksum !== checksum) throw new Error(`Migration ${name} has changed after being applied.`);
      console.log(`${name}: already applied`);
      continue;
    }
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
    console.log(`${name}: applied`);
  }
  await client.query("COMMIT");
} catch (error) {
  try { await client.query("ROLLBACK"); } catch { /* Preserve original error. */ }
  const password = new URL(connectionString).password;
  console.error(String(error).replaceAll(connectionString, "[redacted]").replaceAll(password, "[redacted]"));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
