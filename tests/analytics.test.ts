import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import * as analytics from "../src/lib/analytics.ts";
import { getDb, lockProfiles } from "../src/lib/db.ts";

// These tests delete all profiles and events. Validate both the requested URL
// and the database the server actually selected before any mutations.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("A dedicated analytics test database is required");
let requestedDatabase: string;
try {
  requestedDatabase = decodeURIComponent(new URL(connectionString).pathname.slice(1));
} catch {
  throw new Error("Invalid analytics test database URL");
}
if (!requestedDatabase.startsWith("mm_test_")) throw new Error("Refusing to use a non-test database");

const db = getDb();
let verified = false;

before(async () => {
  const { rows: [row] } = await db.query<{ name: string }>("SELECT current_database() AS name");
  if (!row.name.startsWith("mm_test_") || row.name !== requestedDatabase) {
    throw new Error("Refusing to use a non-test database");
  }
  verified = true;
  // Remove only this suite's instrumentation if a previous run was interrupted.
  await db.query(`DROP TRIGGER IF EXISTS mm_test_analytics_delete ON analytics_events;
    DROP FUNCTION IF EXISTS mm_test_analytics_delete();
    DROP SEQUENCE IF EXISTS mm_test_analytics_attempts`);
});

async function reset() {
  if (!verified) throw new Error("Test database has not been verified");
  await db.query("DELETE FROM analytics_events; DELETE FROM profiles");
  delete process.env.ANALYTICS_ADMIN_USER_IDS;
}

beforeEach(reset);
after(async () => {
  try {
    if (verified) await reset();
  } finally {
    await db.end();
  }
});

async function addProfile(userId: string, consent = 0) {
  await db.query(
    `INSERT INTO profiles
       (user_id, alias, age, gender, seeking, min_age, max_age, answers, vector, questionnaire_version, analytics_consent)
     VALUES ($1, 'Member', 25, 'test', 'test', 18, 80, '{}', '{}', 'test', $2)`,
    [userId, consent],
  );
}

async function addRoom(id: string, a: string, b: string) {
  await db.query("INSERT INTO rooms (id, user_a, user_b) VALUES ($1, $2, $3)", [id, a, b]);
}

async function events(userId: string) {
  return (await db.query<{ event_name: string; metadata: string }>(
    "SELECT event_name, metadata FROM analytics_events WHERE user_id = $1 ORDER BY event_name",
    [userId],
  )).rows;
}

async function blockedBy(pid: number) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const { rows: [row] } = await db.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND $1::int = ANY(pg_blocking_pids(pid))
       ) AS blocked`,
      [pid],
    );
    if (row.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("A concurrent operation did not wait for the profile lock");
}

test("events require consent, reject non-allowlisted names and carry no properties", async () => {
  await addProfile("local:one");
  assert.equal(await analytics.getAnalyticsConsent("local:one"), false);
  assert.equal(await analytics.recordEvent("local:one", "signed_in"), false);
  assert.equal(await analytics.setAnalyticsConsent("local:one", true), true);

  const untypedRecord = analytics.recordEvent as unknown as (...args: unknown[]) => Promise<boolean>;
  assert.equal(await untypedRecord("local:one", "signed_in", { answer: "private", message: "private" }), true);
  assert.equal(await untypedRecord("local:one", "signed_in"), false);
  assert.equal(await untypedRecord("local:one", "message_sent"), false);
  assert.equal(await untypedRecord("local:one", "unknown"), false);
  assert.equal(await analytics.recordEvent("missing", "signed_in"), false);
  assert.deepEqual(await events("local:one"), [{ event_name: "signed_in", metadata: "{}" }]);
});

test("withdrawing consent deletes a user's events and prevents new ones", async () => {
  await addProfile("local:one", 1);
  await addProfile("local:two", 1);
  assert.equal(await analytics.recordEvent("local:one", "signed_in"), true);
  assert.equal(await analytics.recordEvent("local:two", "profile_saved"), true);
  assert.equal(await analytics.setAnalyticsConsent("local:one", false), true);
  assert.equal(await analytics.getAnalyticsConsent("local:one"), false);
  assert.deepEqual(await events("local:one"), []);
  assert.deepEqual(await events("local:two"), [{ event_name: "profile_saved", metadata: "{}" }]);
  assert.equal(await analytics.recordEvent("local:one", "signed_in"), false);
  assert.equal(await analytics.setAnalyticsConsent("missing", true), false);
  assert.equal(await analytics.getAnalyticsConsent("missing"), null);
});

test("pair events require two consents and are purged when either person withdraws", async () => {
  await addProfile("local:one", 1);
  await addProfile("local:two");
  await addProfile("local:three");
  await addRoom("room-private", "local:one", "local:two");
  assert.equal(await analytics.recordMessageEvent("local:one", "room-private"), false);
  assert.equal(await analytics.recordMessageEvent("local:three", "room-private"), false);
  assert.equal(await analytics.setAnalyticsConsent("local:two", true), true);
  assert.equal(await analytics.recordMessageEvent("local:one", "room-private"), true);
  assert.equal(await analytics.recordMessageEvent("local:one", "room-private"), false);
  assert.equal(await analytics.recordMatchEvent("local:one", "room-private"), true);
  assert.equal(await analytics.setAnalyticsConsent("local:three", false), true);
  assert.deepEqual(await events("local:one"), [
    { event_name: "match_created", metadata: "{}" },
    { event_name: "message_sent", metadata: "{}" },
  ]);
  assert.equal(await analytics.setAnalyticsConsent("local:two", false), true);
  assert.deepEqual(await events("local:one"), []);
  assert.equal(await analytics.recordMatchEvent("local:one", "room-private"), false);
});

test("demo and sample accounts never create events or erase real pair events", async () => {
  await addProfile("demo:one", 1);
  await addProfile("sample:one", 1);
  await addProfile("local:one", 1);
  await addProfile("local:two", 1);
  await addRoom("sample-room", "demo:one", "local:one");
  await addRoom("real-room", "local:one", "local:two");
  assert.equal(await analytics.recordEvent("demo:one", "signed_in"), false);
  assert.equal(await analytics.recordEvent("sample:one", "signed_in"), false);
  assert.equal(await analytics.recordMessageEvent("local:one", "sample-room"), false);
  assert.equal(await analytics.recordMessageEvent("local:one", "real-room"), true);
  assert.equal(await analytics.setAnalyticsConsent("sample:one", false), true);
  assert.deepEqual(await events("local:one"), [{ event_name: "message_sent", metadata: "{}" }]);
});

test("simultaneous events are deduplicated by the database", async () => {
  await addProfile("local:one", 1);
  const results = await Promise.all(Array.from({ length: 6 }, () => analytics.recordEvent("local:one", "signed_in")));
  assert.equal(results.filter(Boolean).length, 1);
  assert.deepEqual(await events("local:one"), [{ event_name: "signed_in", metadata: "{}" }]);
});

test("simultaneous withdrawals both complete and remove pair-derived events", async () => {
  await addProfile("local:one", 1);
  await addProfile("local:two", 1);
  await addRoom("room-private", "local:one", "local:two");
  assert.equal(await analytics.recordMessageEvent("local:one", "room-private"), true);
  assert.equal(await analytics.recordMessageEvent("local:two", "room-private"), true);
  assert.deepEqual(await Promise.all([
    analytics.setAnalyticsConsent("local:one", false),
    analytics.setAnalyticsConsent("local:two", false),
  ]), [true, true]);
  assert.equal(await analytics.getAnalyticsConsent("local:one"), false);
  assert.equal(await analytics.getAnalyticsConsent("local:two"), false);
  assert.deepEqual(await events("local:one"), []);
  assert.deepEqual(await events("local:two"), []);
});

test("withdrawal retries a deadlock but rolls back consent on unrelated SQL errors", async () => {
  await addProfile("local:retry", 1);
  await addProfile("local:atomic", 1);
  assert.equal(await analytics.recordEvent("local:retry", "signed_in"), true);
  assert.equal(await analytics.recordEvent("local:atomic", "signed_in"), true);
  try {
    await db.query(`CREATE SEQUENCE mm_test_analytics_attempts;
      CREATE FUNCTION mm_test_analytics_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.user_id = 'local:retry' AND nextval('mm_test_analytics_attempts') = 1 THEN
          RAISE EXCEPTION 'injected deadlock' USING ERRCODE = '40P01';
        ELSIF OLD.user_id = 'local:atomic' THEN
          RAISE EXCEPTION 'injected failure';
        END IF;
        RETURN OLD;
      END $$;
      CREATE TRIGGER mm_test_analytics_delete BEFORE DELETE ON analytics_events
        FOR EACH ROW EXECUTE FUNCTION mm_test_analytics_delete()`);
    assert.equal(await analytics.setAnalyticsConsent("local:retry", false), true);
    assert.equal(await analytics.getAnalyticsConsent("local:retry"), false);
    assert.deepEqual(await events("local:retry"), []);
    await assert.rejects(analytics.setAnalyticsConsent("local:atomic", false), /injected failure/);
    assert.equal(await analytics.getAnalyticsConsent("local:atomic"), true);
    assert.deepEqual(await events("local:atomic"), [{ event_name: "signed_in", metadata: "{}" }]);
  } finally {
    await db.query(`DROP TRIGGER IF EXISTS mm_test_analytics_delete ON analytics_events;
      DROP FUNCTION IF EXISTS mm_test_analytics_delete();
      DROP SEQUENCE IF EXISTS mm_test_analytics_attempts`);
  }
});

test("withdrawal waits for an in-flight pair event then removes it", async () => {
  await addProfile("local:one", 1);
  await addProfile("local:two", 1);
  await addRoom("room-private", "local:one", "local:two");
  const client = await db.connect();
  let open = false;
  let withdrawal: Promise<boolean> | undefined;
  try {
    await client.query("BEGIN");
    open = true;
    const { rows: [row] } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await lockProfiles(client, ["local:one", "local:two"]);
    assert.equal(await analytics.recordRoomEventInTransaction(client, "local:one", "room-private", "message_sent"), true);
    withdrawal = analytics.setAnalyticsConsent("local:two", false);
    await blockedBy(row.pid);
    await client.query("COMMIT");
    open = false;
    assert.equal(await withdrawal, true);
    assert.deepEqual(await events("local:one"), []);
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    client.release();
    if (withdrawal) await withdrawal.catch(() => {});
  }
});

test("a pair event waits for consent withdrawal and rechecks before writing", async () => {
  await addProfile("local:one", 1);
  await addProfile("local:two", 1);
  await addRoom("room-private", "local:one", "local:two");
  const client = await db.connect();
  let open = false;
  let pendingEvent: Promise<boolean> | undefined;
  try {
    await client.query("BEGIN");
    open = true;
    const { rows: [row] } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await lockProfiles(client, ["local:two"]);
    await client.query("UPDATE profiles SET analytics_consent = 0 WHERE user_id = $1", ["local:two"]);
    pendingEvent = analytics.recordMessageEvent("local:one", "room-private");
    await blockedBy(row.pid);
    await client.query("COMMIT");
    open = false;
    assert.equal(await pendingEvent, false);
    assert.deepEqual(await events("local:one"), []);
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    client.release();
    if (pendingEvent) await pendingEvent.catch(() => {});
  }
});

test("an optional analytics SQL failure does not abort the product transaction", async () => {
  await addProfile("local:one", 1);
  await addProfile("local:two", 1);
  await addRoom("room-private", "local:one", "local:two");
  const client = await db.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query(`CREATE TEMP TABLE analytics_events (
      user_id text NOT NULL, event_name text NOT NULL CHECK (event_name <> 'message_sent'),
      occurred_at text NOT NULL, metadata text NOT NULL
    ) ON COMMIT DROP`);
    await lockProfiles(client, ["local:one", "local:two"]);
    await client.query(
      "INSERT INTO messages (id, room_id, sender_id, body) VALUES ($1, $2, $3, $4)",
      ["test-message", "room-private", "local:one", "Example"],
    );
    assert.equal(await analytics.recordRoomEventInTransaction(client, "local:one", "room-private", "message_sent"), false);
    await client.query("SELECT 1");
    await client.query("COMMIT");
    open = false;
    const { rows: [row] } = await db.query<{ count: string }>("SELECT COUNT(*) AS count FROM messages WHERE id = $1", ["test-message"]);
    assert.equal(row.count, "1");
    assert.deepEqual(await events("local:one"), []);
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
});

test("analytics access requires an explicit exact admin ID", async () => {
  assert.equal(analytics.isAnalyticsAdmin("local:admin"), false);
  await assert.rejects(analytics.getAnalyticsReport("local:admin"), /access denied/);
  process.env.ANALYTICS_ADMIN_USER_IDS = " local:admin, local:other ";
  assert.equal(analytics.isAnalyticsAdmin("local:admin"), true);
  assert.equal(analytics.isAnalyticsAdmin("local:ad"), false);
  assert.equal(analytics.isAnalyticsAdmin(""), false);
});

test("reports use a closed UTC week, suppress small cells, and bucket aggregate values", async () => {
  process.env.ANALYTICS_ADMIN_USER_IDS = "local:admin";
  const now = new Date();
  const period = analytics.lastClosedUtcWeek(now);
  const previous = new Date(Date.parse(period.start) - 7 * 86_400_000).toISOString();
  await db.query(`INSERT INTO profiles
    (user_id, alias, age, gender, seeking, min_age, max_age, answers, vector, questionnaire_version, analytics_consent)
    SELECT 'local:member-' || n, 'Member', 25, 'test', 'test', 18, 80, '{}', '{}', 'test', 1
    FROM generate_series(0, 46) AS n`);
  await db.query(`INSERT INTO analytics_events (user_id, event_name, occurred_at)
    SELECT 'local:member-' || n, 'signed_in', $1 FROM generate_series(0, 46) AS n`, [period.start]);
  await db.query(`INSERT INTO analytics_events (user_id, event_name, occurred_at)
    SELECT 'local:member-' || n, 'message_sent', $1 FROM generate_series(0, 22) AS n`, [period.start]);
  await db.query(`INSERT INTO analytics_events (user_id, event_name, occurred_at)
    SELECT 'local:member-' || n, 'onboarding_completed', $1 FROM generate_series(0, 18) AS n`, [period.start]);
  await db.query(`INSERT INTO analytics_events (user_id, event_name, occurred_at)
    SELECT 'local:member-' || n, 'signed_in', $1 FROM generate_series(0, 22) AS n
    UNION ALL SELECT 'local:previous-' || n, 'signed_in', $1 FROM generate_series(0, 26) AS n`, [previous]);
  await db.query("INSERT INTO analytics_events (user_id, event_name, occurred_at) VALUES ($1, 'signed_in', $2), ($3, 'unknown', $4)",
    ["outside-period", period.end, "unknown-event", period.start]);

  const report = await analytics.getAnalyticsReport("local:admin", now);
  assert.deepEqual(report.period, { ...period, timezone: "UTC" });
  assert.equal(report.status, "available");
  assert.deepEqual(report.metrics.activeUsers, { status: "available", minimum: 45 });
  assert.deepEqual(report.metrics.signedInUsers, { status: "insufficient_data", minimum: null });
  assert.deepEqual(report.metrics.messagingUsers, { status: "available", minimum: 20 });
  assert.deepEqual(report.metrics.onboardingCompletedUsers, { status: "insufficient_data", minimum: null });
  assert.deepEqual(report.metrics.weeklyRetention, { status: "available", percentage: 45 });
  assert.deepEqual(analytics.lastClosedUtcWeek(new Date("2026-10-21T14:30:00Z")), {
    start: "2026-10-12T00:00:00.000Z", end: "2026-10-19T00:00:00.000Z",
  });
});

test("reports show no invented values for empty and small cohorts", async () => {
  process.env.ANALYTICS_ADMIN_USER_IDS = "local:admin";
  const now = new Date();
  assert.equal((await analytics.getAnalyticsReport("local:admin", now)).status, "no_data");
  const period = analytics.lastClosedUtcWeek(now);
  await db.query("INSERT INTO analytics_events (user_id, event_name, occurred_at) VALUES ($1, $2, $3)",
    ["local:one", "signed_in", period.start]);
  const report = await analytics.getAnalyticsReport("local:admin", now);
  assert.equal(report.status, "insufficient_data");
  for (const item of Object.values(report.metrics)) assert.equal(item.status, "insufficient_data");
});

test("retention pruning removes old events without deleting recent ones", async () => {
  await db.query(`INSERT INTO analytics_events (user_id, event_name, occurred_at) VALUES
    ('old', 'signed_in', to_char((clock_timestamp() - interval '91 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    ('recent', 'signed_in', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`);
  assert.equal(await analytics.pruneAnalyticsEvents(), 1);
  assert.deepEqual(await events("old"), []);
  assert.deepEqual(await events("recent"), [{ event_name: "signed_in", metadata: "{}" }]);
});
