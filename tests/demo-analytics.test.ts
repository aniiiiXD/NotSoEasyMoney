import assert from "node:assert/strict";
import test from "node:test";

const { isDemoSession, SAMPLE_ACTIVITY, SAMPLE_FUNNEL, samplePercent } = (await import(
  new URL("../src/app/demo/analytics/sample-data.ts", import.meta.url).href
)) as typeof import("../src/app/demo/analytics/sample-data");

test("demo analytics accepts only an issued demo UUID identity", () => {
  assert.equal(isDemoSession("demo:df8496f7-86c1-4507-9b3a-246cfb88786a"), true);
  for (const id of [undefined, null, "", "demo:", "demo:admin", "local:df8496f7-86c1-4507-9b3a-246cfb88786a", "google:demo:df8496f7-86c1-4507-9b3a-246cfb88786a"]) {
    assert.equal(isDemoSession(id), false);
  }
});

test("illustrative funnel percentages use the preceding sample cohort", () => {
  assert.deepEqual(SAMPLE_FUNNEL.map((stage) => stage.count), [240, 198, 156, 96, 60]);
  assert.deepEqual(SAMPLE_FUNNEL.slice(1).map((stage, index) => samplePercent(stage.count, SAMPLE_FUNNEL[index].count)), [83, 79, 62, 63]);
  assert.equal(samplePercent(0, 0), 0);
  assert.equal(SAMPLE_ACTIVITY.length, 7);
  assert.ok(SAMPLE_ACTIVITY.every(({ members }) => members >= 0 && members <= SAMPLE_FUNNEL[0].count));
});
