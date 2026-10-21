import assert from "node:assert/strict";
import test from "node:test";

import {
  isEligiblePair,
  rankCandidates,
  resolveMutualConsent,
  similarityScore,
  type CandidateInput,
  type MatchingProfile,
} from "../src/lib/matching.ts";
import { QUESTIONNAIRE_VERSION, type PersonalityVector } from "../src/lib/personality.ts";

const baseVector: PersonalityVector = {
  social_setting: 0,
  planning_style: 0.25,
  novelty: 0.5,
  conversation_style: 0.75,
  message_frequency: 1,
  date_atmosphere: 0.5,
};

function profile(userId: string, overrides: Partial<MatchingProfile> = {}): MatchingProfile {
  return {
    userId,
    active: true,
    age: 25,
    gender: "nonbinary",
    preferences: { acceptedGenders: ["nonbinary", "woman", "man"], minAge: 18, maxAge: 45 },
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    vector: { ...baseVector },
    blockedUserIds: [],
    excludedUserIds: [],
    ...overrides,
  };
}

function candidate(userId: string, candidateId: string, overrides: Partial<MatchingProfile> = {}): CandidateInput {
  return { profile: profile(userId, overrides), candidateId, blindAlias: `Guest ${candidateId}` };
}

test("both accounts must be active adults and distinct people", () => {
  const viewer = profile("viewer");
  assert.equal(isEligiblePair(viewer, profile("other")), true);
  for (const age of [17, null, 18.5, NaN, Infinity, -1]) {
    assert.equal(isEligiblePair(viewer, profile("other", { age })), false);
    assert.equal(isEligiblePair(profile("viewer", { age }), profile("other")), false);
  }
  assert.equal(isEligiblePair(viewer, profile("other", { age: 18 })), true);
  assert.equal(isEligiblePair(profile("viewer", { active: false }), profile("other")), false);
  assert.equal(isEligiblePair(viewer, profile("other", { active: false })), false);
  assert.equal(isEligiblePair(viewer, profile("viewer")), false);
});

test("gender and age preferences must accept one another without guessing", () => {
  const viewer = profile("viewer", {
    age: 25,
    gender: "nonbinary",
    preferences: { acceptedGenders: ["woman"], minAge: 24, maxAge: 26 },
  });
  const other = profile("other", {
    age: 26,
    gender: "woman",
    preferences: { acceptedGenders: ["nonbinary"], minAge: 25, maxAge: 25 },
  });
  assert.equal(isEligiblePair(viewer, other), true);
  assert.equal(isEligiblePair(viewer, { ...other, age: 27 }), false);
  assert.equal(isEligiblePair(viewer, {
    ...other, preferences: { ...other.preferences!, minAge: 26, maxAge: 40 },
  }), false);
  assert.equal(isEligiblePair(viewer, {
    ...other, preferences: { ...other.preferences!, acceptedGenders: ["woman"] },
  }), false);
  assert.equal(isEligiblePair(viewer, { ...other, gender: null }), false);
  assert.equal(isEligiblePair(viewer, { ...other, preferences: null }), false);
  assert.equal(isEligiblePair(viewer, {
    ...other, preferences: { acceptedGenders: [], minAge: 18, maxAge: 40 },
  }), false);
  assert.equal(isEligiblePair(viewer, {
    ...other, preferences: { acceptedGenders: ["nonbinary"], minAge: 16, maxAge: 40 },
  }), false);
  assert.equal(isEligiblePair(viewer, {
    ...other, preferences: { acceptedGenders: ["nonbinary"], minAge: 40, maxAge: 18 },
  }), false);
});

test("a block, pass, or unmatch in either direction excludes the pair", () => {
  const a = profile("a");
  const b = profile("b");
  for (const field of ["blockedUserIds", "excludedUserIds"] as const) {
    assert.equal(isEligiblePair({ ...a, [field]: ["b"] }, b), false);
    assert.equal(isEligiblePair(a, { ...b, [field]: ["a"] }), false);
  }
  assert.equal(isEligiblePair(a, { ...b, blockedUserIds: ["someone-else"] }), true);
});

test("only equal supported questionnaire versions with three shared answers can rank", () => {
  const a = profile("a", { vector: { ...baseVector, conversation_style: null, message_frequency: null, date_atmosphere: null } });
  const b = profile("b");
  assert.equal(similarityScore(a, b), 1);
  assert.equal(isEligiblePair(a, b), true);
  const onlyTwoShared = profile("b", { vector: { ...baseVector, novelty: null } });
  assert.equal(similarityScore(a, onlyTwoShared), null);
  assert.equal(isEligiblePair(a, onlyTwoShared), false);
  assert.equal(similarityScore(a, { ...b, questionnaireVersion: "2.0.0" }), null);
  assert.equal(similarityScore({ ...a, questionnaireVersion: "2.0.0" }, { ...b, questionnaireVersion: "2.0.0" }), null);
});

test("missing answers are ignored, and malformed vectors fail closed", () => {
  const a = profile("a", { vector: { ...baseVector, message_frequency: null } });
  const b = profile("b", { vector: { ...baseVector, message_frequency: 0 } });
  assert.equal(similarityScore(a, b), 1);
  const malformed = [
    { ...baseVector, social_setting: -0.1 },
    { ...baseVector, social_setting: 1.1 },
    { ...baseVector, social_setting: NaN },
    { ...baseVector, social_setting: undefined },
    { ...baseVector, unknown: 0.5 },
    null,
    [],
  ];
  for (const vector of malformed) {
    assert.equal(similarityScore(a, { ...b, vector: vector as PersonalityVector }), null);
    assert.equal(isEligiblePair(a, { ...b, vector: vector as PersonalityVector }), false);
  }
});

test("ranking orders by similarity with a deterministic tie break and returns only blind cards", () => {
  const viewer = profile("viewer");
  const farther = candidate("farther", "tok-farther", {
    vector: { ...baseVector, social_setting: 1, planning_style: 1 },
  });
  const nearZ = candidate("near-z", "tok-z");
  const nearA = candidate("near-a", "tok-a");
  const blocked = candidate("blocked", "tok-blocked", { blockedUserIds: ["viewer"] });
  const pool = [farther, nearZ, blocked, nearA];
  const ranked = rankCandidates(viewer, pool);
  assert.deepEqual(ranked.map((item) => item.candidateId), ["tok-a", "tok-z", "tok-farther"]);
  assert.deepEqual(rankCandidates(viewer, [...pool].reverse()), ranked);
  for (const card of ranked) {
    assert.deepEqual(Object.keys(card).sort(), ["blindAlias", "candidateId", "explanation"]);
    assert.equal(card.explanation, "Suggested based on overlapping answers and mutual preferences.");
    assert.equal(JSON.stringify(card).includes("userId"), false);
    assert.equal(JSON.stringify(card).includes("vector"), false);
    assert.equal(JSON.stringify(card).includes("score"), false);
  }
});

test("ambiguous tokens, duplicate people, or absent blind fields never enter the candidate list", () => {
  const viewer = profile("viewer");
  const cards = rankCandidates(viewer, [
    candidate("same-person", "tok-1"), candidate("same-person", "tok-2"),
    candidate("one", "tok-duplicate"), candidate("two", "tok-duplicate"),
    { ...candidate("three", "tok-3"), blindAlias: " " },
    { ...candidate("four", "tok-4"), candidateId: "" },
    candidate("safe", "tok-safe"),
  ]);
  assert.deepEqual(cards.map((item) => item.candidateId), ["tok-safe"]);
});

test("matching requires two likes and rechecks safety at the point of consent", () => {
  const a = profile("a");
  const b = profile("b");
  assert.equal(resolveMutualConsent(a, b, "like", "like"), "matched");
  assert.equal(resolveMutualConsent(a, b, "like", "undecided"), "pending");
  assert.equal(resolveMutualConsent(a, b, "undecided", "like"), "pending");
  assert.equal(resolveMutualConsent(a, b, "undecided", "undecided"), "pending");
  assert.equal(resolveMutualConsent(a, b, "like", "pass"), "passed");
  assert.equal(resolveMutualConsent(a, b, "pass", "like"), "passed");
  assert.equal(resolveMutualConsent(a, { ...b, blockedUserIds: ["a"] }, "like", "like"), "unavailable");
  assert.equal(resolveMutualConsent(a, { ...b, excludedUserIds: ["a"] }, "like", "like"), "unavailable");
  assert.equal(resolveMutualConsent(a, { ...b, active: false }, "like", "like"), "unavailable");
  assert.equal(resolveMutualConsent(a, b, "like", "invalid" as "like"), "unavailable");
});
