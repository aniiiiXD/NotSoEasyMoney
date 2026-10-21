import { mkdirSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

// This database is intentionally local to one machine. It is not suitable for
// multi-instance hosting or deployment to a filesystem that is ephemeral.
const databasePath = () => process.env.SQLITE_PATH || join(process.cwd(), ".local", "closer.sqlite");

const databaseGlobal = globalThis as typeof globalThis & {
  __closerDatabases?: Map<string, DatabaseSync>;
};

/** Open and initialize the local SQLite store; safe to call from server code. */
export function getDb(): DatabaseSync {
  const configuredPath = databasePath();
  // The database is runtime data, never an asset to bundle into a build.
  const path = configuredPath === ":memory:" ? configuredPath : resolve(/*turbopackIgnore: true*/ configuredPath);
  const databases = (databaseGlobal.__closerDatabases ??= new Map());
  const existing = databases.get(path);
  if (existing) return existing;

  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY,
      alias TEXT NOT NULL,
      age INTEGER NOT NULL CHECK(age >= 18),
      gender TEXT NOT NULL,
      seeking TEXT NOT NULL,
      min_age INTEGER NOT NULL CHECK(min_age >= 18),
      max_age INTEGER NOT NULL CHECK(max_age >= min_age),
      answers TEXT NOT NULL,
      vector TEXT NOT NULL,
      questionnaire_version TEXT NOT NULL,
      analytics_consent INTEGER NOT NULL DEFAULT 0 CHECK(analytics_consent IN (0, 1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS decisions (
      actor_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      decision TEXT NOT NULL CHECK(decision IN ('like', 'pass')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (actor_id, target_id),
      CHECK(actor_id <> target_id)
    );
    CREATE TABLE IF NOT EXISTS candidate_tokens (
      token TEXT PRIMARY KEY,
      viewer_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      UNIQUE(viewer_id, target_id),
      CHECK(viewer_id <> target_id)
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      user_a TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      user_b TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(user_a, user_b),
      CHECK(user_a < user_b)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS messages_room_time ON messages(room_id, created_at, id);
    CREATE INDEX IF NOT EXISTS messages_sender_time ON messages(sender_id, created_at);
    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY(blocker_id, blocked_id),
      CHECK(blocker_id <> blocked_id)
    );
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS analytics_event_time ON analytics_events(event_name, occurred_at);
    CREATE INDEX IF NOT EXISTS analytics_user_event_time ON analytics_events(user_id, event_name, occurred_at);
    CREATE TABLE IF NOT EXISTS local_test_accounts (
      handle TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  databases.set(path, db);
  return db;
}
