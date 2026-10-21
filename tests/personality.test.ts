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
} = (await import(new URL("../src/lib/personality.ts", import.meta.url).href)) as typeof import("../src/lib/personality");

const answers: PersonalityAnswers = {
  social_setting: 1,
  planning_style: 2,
  novelty: 3,
  conversation_style: 4,
  message_frequency: 5,
  date_atmosphere: null,
};

test("questionnaire exposes each stable ID once with five ordered anchors", () => {
  assert.equal(QUESTIONNAIRE.version, QUESTIONNAIRE_VERSION);
  assert.deepEqual(QUESTIONS.map((question) => question.id), QUESTION_IDS);
  assert.equal(new Set(QUESTION_IDS).size, 6);
  for (const question of QUESTIONS) {
    assert.ok(question.prompt.trim().length > 0);
    assert.equal(question.anchors.length, 5);
    assert.equal(new Set(question.anchors).size, 5);
    assert.ok(question.anchors.every((anchor) => anchor.trim().length > 0));
  }
});

test("normalization maps all five values and preserves an explicit skip", () => {
  assert.deepEqual(normalizeAnswers(answers), {
    social_setting: 0,
    planning_style: 0.25,
    novelty: 0.5,
    conversation_style: 0.75,
    message_frequency: 1,
    date_atmosphere: null,
  });
  assert.deepEqual(answers, {
    social_setting: 1,
    planning_style: 2,
    novelty: 3,
    conversation_style: 4,
    message_frequency: 5,
    date_atmosphere: null,
  });
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
  parsed.social_setting = 5;
  assert.equal(input.social_setting, 1);
});

test("rejects missing, additional, inherited, and non-object inputs", () => {
  const missing = Object.fromEntries(
    QUESTION_IDS.filter((id) => id !== "novelty").map((id) => [id, answers[id]]),
  );
  const inherited = Object.assign(Object.create({ novelty: 3 }), missing);
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
      () => normalizeAnswers({ ...answers, social_setting: invalid }),
      /Answer for social_setting must be an integer from 1 to 5 or null/,
    );
  }
});
