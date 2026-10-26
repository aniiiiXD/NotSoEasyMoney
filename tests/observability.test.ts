import { after, test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "../src/lib/db.ts";
import { isObservabilityAdmin, observabilitySnapshot, observe, withObservability } from "../src/lib/observability.ts";

const databaseUrl = process.env.DATABASE_URL;
let databaseName = "";
try { if (databaseUrl) databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1)); } catch { /* rejected below */ }
if (!/^mm_test_[a-z0-9_]+$/i.test(databaseName)) throw new Error("Observability tests require a disposable mm_test_ database in DATABASE_URL.");
const db = getDb();
after(async () => {
  await db.query("DELETE FROM observability_events WHERE kind LIKE 'test.%'");
  await db.end();
});

async function count(kind: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>("SELECT count(*) AS count FROM observability_events WHERE kind = $1", [kind]);
  return Number(rows[0].count);
}

/** Exact-count assertions need a clean table; the DB is disposable. */
async function resetObservability(): Promise<void> {
  await db.query("TRUNCATE TABLE observability_events");
}

/** Fire-and-forget inserts land asynchronously; wait until the count is stable. */
async function settle(): Promise<void> {
  let previous = -1;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { rows } = await db.query<{ count: string }>("SELECT count(*) AS count FROM observability_events");
    const current = Number(rows[0].count);
    if (current === previous && current > 0) return;
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

test("observability admin check requires exact allow-listed IDs", () => {
  const env = { OBSERVABILITY_ADMIN_USER_IDS: "google:one, google:two" };
  assert.equal(isObservabilityAdmin("google:one", env), true);
  assert.equal(isObservabilityAdmin("google:one ", env), false);
  assert.equal(isObservabilityAdmin("google:three", env), false);
  assert.equal(isObservabilityAdmin(undefined, env), false);
  assert.equal(isObservabilityAdmin("", env), false);
  assert.equal(isObservabilityAdmin("x".repeat(513), env), false);
  assert.equal(isObservabilityAdmin("google:one", {}), false);
});

test("observe persists fire-and-forget events without content or throwing", async () => {
  await resetObservability();
  observe({ kind: "test.plain", actor: "google:actor-1", outcome: "ok", durationMs: 12, detail: { status: 200 } }, () => db);
  observe({ kind: "test.nothing" }, () => db);
  observe({ kind: "test.plain", actor: "google:actor-2", outcome: "rejected_404", durationMs: 4, detail: { status: 404 } }, () => db);
  await settle();
  assert.equal(await count("test.plain"), 2);
  assert.equal(await count("test.nothing"), 1);
  const { rows } = await db.query<{ detail: Record<string, unknown> | null; outcome: string | null }>(
    "SELECT detail, outcome FROM observability_events WHERE kind = 'test.plain' ORDER BY duration_ms");
  assert.equal(rows[0].outcome, "rejected_404");
  assert.deepEqual(rows[0].detail, { status: 404 });
});

test("withObservability classifies outcomes and rethrows handler crashes", async () => {
  await resetObservability();
  const ok = await withObservability("test.wrapper", async () => ({
    actor: "google:actor-3",
    response: Response.json({ fine: true }, { status: 200 }),
  }));
  assert.equal(ok.status, 200);
  await withObservability("test.wrapper", async () => ({
    actor: "google:actor-3",
    response: Response.json({ error: "no" }, { status: 404 }),
  }));
  await assert.rejects(
    withObservability("test.wrapper", async () => { throw new Error("exploded"); }),
    /exploded/,
  );
  await settle();
  const { rows } = await db.query<{ outcome: string }>(
    "SELECT outcome FROM observability_events WHERE kind = 'test.wrapper'");
  // Fire-and-forget inserts race, so compare the outcome set, not the order.
  assert.deepEqual(rows.map((row) => row.outcome).sort(), ["crashed", "ok", "rejected_404"]);
});

test("snapshot computes counts, percentiles, funnels and prunes old events", async () => {
  await resetObservability();
  // Synthetic chat latency series: p50 = 200, p95 = 290 for [100, 200, 300].
  for (const durationMs of [100, 200, 300]) {
    observe({ kind: "test.metric", actor: "google:actor-4", outcome: "ok", durationMs }, () => db);
  }
  observe({ kind: "api.message.send", actor: "google:actor-4", outcome: "ok", durationMs: 30 }, () => db);
  observe({ kind: "api.message.send", actor: "google:actor-4", outcome: "rejected_429", durationMs: 5 }, () => db);
  observe({ kind: "api.payments.create_order", actor: "google:actor-4", outcome: "ok", durationMs: 120 }, () => db);
  observe({ kind: "api.payments.webhook", outcome: "rejected_400", durationMs: 9 }, () => db);
  observe({ kind: "test.ancient", outcome: "ok" }, () => db);
  await settle();
  await db.query("UPDATE observability_events SET ts = now() - interval '91 days' WHERE kind = 'test.ancient'");
  const before = await count("test.ancient");
  assert.equal(before, 1);

  const snapshot = await observabilitySnapshot(db);
  const metric = snapshot.kinds.find((item) => item.kind === "test.metric")!;
  assert.equal(metric.total, 3);
  assert.equal(metric.ok, 3);
  assert.equal(metric.errors, 0);
  assert.equal(metric.p50, 200);
  assert.equal(metric.p95, 290);

  assert.equal(snapshot.chat.messagesSent, 1);
  assert.equal(snapshot.chat.rateLimited, 1);
  assert.equal(snapshot.payments.ordersCreated, 1);
  assert.equal(snapshot.payments.webhookFailures, 1);
  // This test truncated the table first: 3 metrics + 2 sends + 1 order + 1 webhook
  // are in the 24h window; the 91-day-old event is correctly excluded.
  assert.equal(snapshot.totalEvents, 7);
  assert.ok(snapshot.hourly.length >= 1, "hourly histogram has buckets");

  // Retention: the 91-day-old event is gone after the snapshot's prune step.
  assert.equal(await count("test.ancient"), 0);
  // The health counters were captured before the prune, so the ancient event
  // still appears in the all-time count.
  assert.equal(snapshot.dbHealth.eventsTotal, 8);
});
