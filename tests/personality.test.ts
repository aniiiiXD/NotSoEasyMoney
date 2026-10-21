import assert from "node:assert/strict";
import test from "node:test";

import type { PersonalityAnswers } from "../src/lib/personality";

// Node's built-in runner loads TypeScript by file URL; the type-only import
// remains compatible with standard Next.js TypeScript configuration.
const {
  normalizeAnswers,
  parsePersonalityAnswers,
  QUESTION_IDS,
  QUESTIONNAIRE,
  QUESTIONNAIRE_VERSION,
  QUESTIONS,
  answersInOrder,
  emptyAnswers,
  hasAnswers,
} = (await import(new URL("../src/lib/personality.ts", import.meta.url).href)) as typeof import("../src/lib/personality");

// The first five questions use every value; the rest are skipped.
const answers = Object.fromEntries(
  QUESTION_IDS.map((id, index) => [id, index < 5 ? index + 1 : null]),
) as PersonalityAnswers;

test("questionnaire exposes each stable ID once with five ordered anchors", () => {
  assert.equal(QUESTIONNAIRE.version, QUESTIONNAIRE_VERSION);
  assert.deepEqual(QUESTIONS.map((question) => question.id), QUESTION_IDS);
  assert.equal(new Set(QUESTION_IDS).size, 20);
  for (const question of QUESTIONS) {
    assert.ok(question.prompt.trim().length > 0);
    assert.ok(question.source.trim().length > 0);
    assert.equal(question.anchors.length, 5);
    assert.equal(new Set(question.anchors).size, 5);
    assert.ok(question.anchors.every((anchor) => anchor.trim().length > 0));
  }
});

test("normalization maps all five values and preserves an explicit skip", () => {
  assert.deepEqual(
    normalizeAnswers(answers),
    Object.fromEntries(QUESTION_IDS.map((id, index) => [id, index < 5 ? index / 4 : null])),
  );
  assert.deepEqual(answers, Object.fromEntries(QUESTION_IDS.map((id, index) => [id, index < 5 ? index + 1 : null])));
});

test("all skipped answers remain null instead of becoming neutral", () => {
  const skipped = Object.fromEntries(QUESTION_IDS.map((id) => [id, null]));
  assert.deepEqual(normalizeAnswers(skipped), skipped);
});

test("validated answers are copied, including for objects without a prototype", () => {
  const input = Object.assign(Object.create(null), answers);
  const parsed = parsePersonalityAnswers(input);
  assert.deepEqual(parsed, answers);
  assert.notStrictEqual(parsed, input);
  parsed.life_of_party = 5;
  assert.equal(input.life_of_party, 1);
});

test("rejects missing, additional, inherited, and non-object inputs", () => {
  const missing = Object.fromEntries(
    QUESTION_IDS.filter((id) => id !== "dont_talk_much").map((id) => [id, answers[id]]),
  );
  const inherited = Object.assign(Object.create({ dont_talk_much: 3 }), missing);
  const extraSymbol = { ...answers, [Symbol("unexpected")]: 1 };
  for (const input of [
    missing,
    { ...answers, unexpected: 1 },
    inherited,
    extraSymbol,
    null,
    undefined,
    [],
    "answers",
  ]) {
    assert.throws(() => normalizeAnswers(input), TypeError);
  }
});

test("rejects non-integer, non-numeric, absent, and out-of-range values", () => {
  for (const invalid of [0, 6, 1.5, -1, NaN, Infinity, -Infinity, "1", true, undefined]) {
    assert.throws(
      () => normalizeAnswers({ ...answers, life_of_party: invalid }),
      /Answer for life_of_party must be an integer from 1 to 5 or null/,
    );
  }
});

test("answers can be built in question order, and empty answers have none", () => {
  const values = QUESTION_IDS.map((_, index) => (index % 5) + 1) as (1 | 2 | 3 | 4 | 5)[];
  const built = answersInOrder(values);
  assert.deepEqual(QUESTION_IDS.map((id) => built[id]), values);
  assert.throws(() => answersInOrder(values.slice(1)), RangeError);
  assert.equal(hasAnswers(built), true);
  assert.equal(hasAnswers(emptyAnswers()), false);
  assert.deepEqual(parsePersonalityAnswers(emptyAnswers()), emptyAnswers());
});
