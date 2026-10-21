import assert from "node:assert/strict";
import test from "node:test";

process.env.SQLITE_PATH = ":memory:";

const analytics = (await import(new URL("../src/lib/analytics.ts", import.meta.url).href)) as typeof import("../src/lib/analytics");
const { getDb } = (await import(new URL("../src/lib/db.ts", import.meta.url).href)) as typeof import("../src/lib/db");
const db = getDb();

function reset() {
  db.exec("DELETE FROM analytics_events; DELETE FROM profiles;");
  delete process.env.ANALYTICS_ADMIN_USER_IDS;
}

function addProfile(userId: string, consent = 0) {
  db.prepare(
    `INSERT INTO profiles (user_id, alias, age, gender, seeking, min_age, max_age,
                           answers, vector, questionnaire_version, analytics_consent)
     VALUES (?, 'Member', 25, 'test', 'test', 18, 80, '{}', '{}', 'test', ?)`,
  ).run(userId, consent);
}

function eventRows(userId: string) {
  return db.prepare("SELECT event_name, metadata FROM analytics_events WHERE user_id = ? ORDER BY event_name").all(userId);
}

test("events require consent, are allowlisted and store no caller properties", () => {
  reset();
  addProfile("local:one");
  assert.equal(analytics.getAnalyticsConsent("local:one"), false);
  assert.equal(analytics.recordEvent("local:one", "signed_in"), false);
  assert.deepEqual(eventRows("local:one"), []);

  assert.equal(analytics.setAnalyticsConsent("local:one", true), true);
  assert.equal(analytics.recordEvent("local:one", "signed_in"), true);
  assert.equal(analytics.recordEvent("local:one", "signed_in"), false);
  assert.equal(analytics.recordEvent("local:one", "unknown" as never), false);
  const untypedRecord = analytics.recordEvent as (...args: unknown[]) => boolean;
  assert.equal(untypedRecord("local:one", "profile_saved", { text: "private", score: 99 }), true);
  assert.equal(untypedRecord("local:one", "message_sent", { text: "private" }), false);
  assert.deepEqual(eventRows("local:one").map((row) => ({ ...row })), [
    { event_name: "profile_saved", metadata: "{}" },
    { event_name: "signed_in", metadata: "{}" },
  ]);
});

test("withdrawing consent deletes only that member's events and prevents future capture", () => {
  reset();
  addProfile("local:one", 1);
  addProfile("local:two", 1);
  analytics.recordEvent("local:one", "profile_saved");
  analytics.recordEvent("local:two", "profile_saved");
  assert.equal(analytics.setAnalyticsConsent("local:one", false), true);
  assert.equal(analytics.getAnalyticsConsent("local:one"), false);
  assert.deepEqual(eventRows("local:one"), []);
  assert.equal(eventRows("local:two").length, 1);
  assert.equal(analytics.recordEvent("local:one", "signed_in"), false);
  assert.equal(analytics.setAnalyticsConsent("local:missing", true), false);
  assert.equal(analytics.getAnalyticsConsent("local:missing"), null);
});

test("pair events require both room participants to consent and never store room data", () => {
  reset();
  addProfile("local:one", 1);
  addProfile("local:two");
  addProfile("local:three", 1);
  addProfile("local:outsider");
  db.prepare("INSERT INTO rooms (id, user_a, user_b) VALUES (?, ?, ?)").run("room-private", "local:one", "local:two");
  assert.equal(analytics.recordMessageEvent("local:one", "room-private"), false);
  assert.equal(analytics.recordMatchEvent("local:one", "room-private"), false);
  assert.equal(analytics.recordMessageEvent("local:three", "room-private"), false);
  assert.equal(analytics.setAnalyticsConsent("local:two", true), true);
  assert.equal(analytics.recordMessageEvent("local:one", "room-private"), true);
  assert.equal(analytics.recordMessageEvent("local:one", "room-private"), false);
  assert.equal(analytics.recordMatchEvent("local:one", "room-private"), true);
  assert.equal(analytics.recordMatchEvent("local:two", "room-private"), true);
  assert.equal(analytics.recordMatchEvent("local:three", "room-private"), false);
  assert.equal(analytics.setAnalyticsConsent("local:outsider", false), true);
  assert.deepEqual(eventRows("local:one").map((row) => ({ ...row })), [
    { event_name: "match_created", metadata: "{}" },
    { event_name: "message_sent", metadata: "{}" },
  ]);
  assert.equal(analytics.setAnalyticsConsent("local:two", false), true);
  assert.deepEqual(eventRows("local:one"), []);
  assert.deepEqual(eventRows("local:two"), []);
  assert.equal(analytics.recordMessageEvent("local:one", "room-private"), false);
});

test("sample activity does not enter or clear real analytics", () => {
  reset();
  addProfile("demo:one", 1);
  addProfile("sample:one", 1);
  addProfile("local:one", 1);
  addProfile("local:two", 1);
  db.prepare("INSERT INTO rooms (id, user_a, user_b) VALUES (?, ?, ?)").run("sample-room", "demo:one", "sample:one");
  db.prepare("INSERT INTO rooms (id, user_a, user_b) VALUES (?, ?, ?)").run("real-room", "local:one", "local:two");
  db.prepare("INSERT INTO rooms (id, user_a, user_b) VALUES (?, ?, ?)").run("mixed-demo-room", "demo:one", "local:one");
  db.prepare("INSERT INTO rooms (id, user_a, user_b) VALUES (?, ?, ?)").run("mixed-sample-room", "local:one", "sample:one");
  assert.equal(analytics.recordEvent("demo:one", "profile_saved"), false);
  assert.equal(analytics.recordEvent("sample:one", "profile_saved"), false);
  assert.equal(analytics.recordMessageEvent("demo:one", "sample-room"), false);
  assert.equal(analytics.recordMatchEvent("sample:one", "sample-room"), false);
  assert.equal(analytics.recordMessageEvent("local:one", "mixed-demo-room"), false);
  assert.equal(analytics.recordMatchEvent("local:one", "mixed-sample-room"), false);
  assert.equal(analytics.recordMessageEvent("local:one", "real-room"), true);
  assert.equal(analytics.setAnalyticsConsent("demo:one", false), true);
  assert.deepEqual(eventRows("local:one").map((row) => ({ ...row })), [
    { event_name: "message_sent", metadata: "{}" },
  ]);
});

test("admin access fails closed and accepts only exact allowlisted session IDs", () => {
  reset();
  assert.equal(analytics.isAnalyticsAdmin("local:admin"), false);
  assert.throws(() => analytics.getAnalyticsReport("local:admin"), /access denied/);
  process.env.ANALYTICS_ADMIN_USER_IDS = " google:123, local:admin ";
  assert.equal(analytics.isAnalyticsAdmin("local:admin"), true);
  assert.equal(analytics.isAnalyticsAdmin("google:123"), true);
  assert.equal(analytics.isAnalyticsAdmin("local:Admin"), false);
  assert.equal(analytics.isAnalyticsAdmin("local:admin,google:123"), false);
});

test("report uses a closed UTC week and suppresses small counts and complements", () => {
  reset();
  process.env.ANALYTICS_ADMIN_USER_IDS = "local:admin";
  const now = new Date();
  const period = analytics.lastClosedUtcWeek(now);
  assert.deepEqual(analytics.lastClosedUtcWeek(new Date("2026-10-21T23:00:00Z")), {
    start: "2026-10-12T00:00:00.000Z",
    end: "2026-10-19T00:00:00.000Z",
  });
  assert.equal(analytics.getAnalyticsReport("local:admin", now).status, "no_data");
  const insert = db.prepare("INSERT INTO analytics_events (user_id, event_name, occurred_at, metadata) VALUES (?, ?, ?, '{}')");
  for (let index = 0; index < 47; index++) {
    const userId = `local:member-${index}`;
    addProfile(userId, 1);
    insert.run(userId, "signed_in", period.start);
    if (index < 23) insert.run(userId, "message_sent", period.start);
    if (index < 19) insert.run(userId, "onboarding_completed", period.start);
  }
  const previousWeek = new Date(Date.parse(period.start) - 7 * 86_400_000).toISOString();
  for (let index = 0; index < 23; index++) {
    insert.run(`local:member-${index}`, "signed_in", previousWeek);
  }
  for (let index = 0; index < 27; index++) {
    const userId = `local:previous-${index}`;
    addProfile(userId, 1);
    insert.run(userId, "signed_in", previousWeek);
  }
  // Current-week and unknown event names do not enter the report.
  insert.run("local:extra", "message_sent", period.end);
  insert.run("local:untrusted", "unknown", period.start);
  const report = analytics.getAnalyticsReport("local:admin", now);
  assert.equal(report.status, "available");
  assert.deepEqual(report.period, { ...period, timezone: "UTC" });
  assert.deepEqual(report.metrics.activeUsers, { status: "available", minimum: 45 });
  assert.deepEqual(report.metrics.messagingUsers, { status: "available", minimum: 20 });
  assert.deepEqual(report.metrics.onboardingCompletedUsers, { status: "insufficient_data", minimum: null });
  assert.deepEqual(report.metrics.signedInUsers, { status: "insufficient_data", minimum: null });
  assert.deepEqual(report.metrics.weeklyRetention, { status: "available", percentage: 45 });
});

test("an under-threshold cohort is never returned as an exact number", () => {
  reset();
  process.env.ANALYTICS_ADMIN_USER_IDS = "local:admin";
  const now = new Date();
  const period = analytics.lastClosedUtcWeek(now);
  addProfile("local:one", 1);
  db.prepare("INSERT INTO analytics_events (user_id, event_name, occurred_at, metadata) VALUES (?, ?, ?, '{}')")
    .run("local:one", "message_sent", period.start);
  const report = analytics.getAnalyticsReport("local:admin", now);
  assert.equal(report.status, "insufficient_data");
  const { weeklyRetention, ...counts } = report.metrics;
  for (const value of Object.values(counts)) {
    assert.deepEqual(value, { status: "insufficient_data", minimum: null });
  }
  assert.deepEqual(weeklyRetention, { status: "insufficient_data", percentage: null });
});

test("maintenance removes expired events", () => {
  reset();
  addProfile("local:one", 1);
  db.prepare("INSERT INTO analytics_events (user_id, event_name, occurred_at, metadata) VALUES (?, ?, ?, '{}')")
    .run("local:one", "message_sent", "2000-01-01T00:00:00.000Z");
  assert.equal(analytics.pruneAnalyticsEvents(), 1);
  assert.deepEqual(eventRows("local:one"), []);
});
