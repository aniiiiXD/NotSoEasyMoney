import {
  QUESTION_IDS,
  QUESTIONNAIRE_VERSION,
  type PersonalityVector,
} from "./personality.ts";

/** Exact, user-selected gender IDs; no orientation is inferred. */
export interface MatchingPreferences {
  readonly acceptedGenders: readonly string[];
  readonly minAge: number;
  readonly maxAge: number;
}

/**
 * Private, server-side input. Age is self-reported in this local prototype;
 * it is not an assertion of age verification.
 * Active means the account is allowed to participate and has not paused matching.
 * Exclusions include prior passes and unmatches; blocks apply in both directions.
 */
export interface MatchingProfile {
  readonly userId: string;
  readonly active: boolean;
  readonly age: number | null;
  readonly gender: string | null;
  readonly preferences: MatchingPreferences | null;
  readonly questionnaireVersion: string;
  readonly vector: PersonalityVector;
  readonly blockedUserIds: readonly string[];
  readonly excludedUserIds: readonly string[];
}

/**
 * The caller must supply a random opaque token scoped to this viewer and a
 * non-identifying alias. Never substitute a user ID, email, or real name.
 */
export interface CandidateInput {
  readonly profile: MatchingProfile;
  readonly candidateId: string;
  readonly blindAlias: string;
}

/** This is the only candidate data intended for display. */
export interface Candidate {
  readonly candidateId: string;
  readonly blindAlias: string;
  readonly explanation: string;
}

export type MatchDecision = "undecided" | "like" | "pass";
export type MutualConsentOutcome = "unavailable" | "pending" | "matched" | "passed";

const MIN_SHARED_ANSWERS = 3;
const EXPLANATION = "Suggested based on overlapping answers and mutual preferences.";

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function validPreferences(value: MatchingPreferences | null): value is MatchingPreferences {
  return value !== null &&
    typeof value === "object" &&
    validStringList(value.acceptedGenders) &&
    value.acceptedGenders.length > 0 &&
    Number.isSafeInteger(value.minAge) && value.minAge >= 18 &&
    Number.isSafeInteger(value.maxAge) && value.maxAge >= value.minAge;
}

function validProfile(profile: MatchingProfile): boolean {
  return profile != null &&
    nonEmptyString(profile.userId) &&
    profile.active === true &&
    Number.isSafeInteger(profile.age) && (profile.age as number) >= 18 &&
    nonEmptyString(profile.gender) &&
    validPreferences(profile.preferences) &&
    validStringList(profile.blockedUserIds) &&
    validStringList(profile.excludedUserIds);
}

function validVector(vector: PersonalityVector): boolean {
  if (typeof vector !== "object" || vector === null || Array.isArray(vector)) {
    return false;
  }

  const keys = Reflect.ownKeys(vector);
  if (keys.length !== QUESTION_IDS.length ||
    keys.some((key) => typeof key !== "string" || !QUESTION_IDS.includes(key as typeof QUESTION_IDS[number]))) {
    return false;
  }

  return QUESTION_IDS.every((id) => {
    if (!Object.prototype.hasOwnProperty.call(vector, id)) return false;
    const value = vector[id];
    return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
  });
}

/**
 * Private ranking heuristic, not an attraction/compatibility prediction.
 * Do not include this score or any input vector in API responses or analytics.
 * Missing answers are skipped rather than interpreted as zero or a midpoint.
 */
export function similarityScore(a: MatchingProfile, b: MatchingProfile): number | null {
  if (a?.questionnaireVersion !== QUESTIONNAIRE_VERSION ||
    b?.questionnaireVersion !== QUESTIONNAIRE_VERSION ||
    !validVector(a.vector) || !validVector(b.vector)) return null;

  let shared = 0;
  let difference = 0;
  for (const id of QUESTION_IDS) {
    const first = a.vector[id];
    const second = b.vector[id];
    if (first !== null && second !== null) {
      shared += 1;
      difference += Math.abs(first - second);
    }
  }

  return shared < MIN_SHARED_ANSWERS ? null : 1 - difference / shared;
}

/** Fail closed unless both people satisfy every rule. */
export function isEligiblePair(a: MatchingProfile, b: MatchingProfile): boolean {
  if (!validProfile(a) || !validProfile(b) || a.userId === b.userId) return false;
  if (a.blockedUserIds.includes(b.userId) || b.blockedUserIds.includes(a.userId) ||
    a.excludedUserIds.includes(b.userId) || b.excludedUserIds.includes(a.userId)) return false;

  const aPreferences = a.preferences as MatchingPreferences;
  const bPreferences = b.preferences as MatchingPreferences;
  const aAge = a.age as number;
  const bAge = b.age as number;
  const aGender = a.gender as string;
  const bGender = b.gender as string;
  if (!aPreferences.acceptedGenders.includes(bGender) ||
    !bPreferences.acceptedGenders.includes(aGender) ||
    bAge < aPreferences.minAge || bAge > aPreferences.maxAge ||
    aAge < bPreferences.minAge || aAge > bPreferences.maxAge) return false;

  return similarityScore(a, b) !== null;
}

/**
 * Produce blind candidate cards ordered by private similarity and then by
 * opaque token. Duplicate tokens or duplicate people are discarded so a
 * malformed candidate pool cannot conflate two identities.
 */
export function rankCandidates(viewer: MatchingProfile, inputs: readonly CandidateInput[]): Candidate[] {
  const scored = inputs.flatMap((input) => {
    if (!input || !nonEmptyString(input.candidateId) || !nonEmptyString(input.blindAlias) ||
      !isEligiblePair(viewer, input.profile)) return [];
    const score = similarityScore(viewer, input.profile);
    return score === null ? [] : [{ input, score }];
  });

  const tokenCounts = new Map<string, number>();
  const userCounts = new Map<string, number>();
  for (const { input } of scored) {
    tokenCounts.set(input.candidateId, (tokenCounts.get(input.candidateId) ?? 0) + 1);
    userCounts.set(input.profile.userId, (userCounts.get(input.profile.userId) ?? 0) + 1);
  }

  return scored
    .filter(({ input }) => tokenCounts.get(input.candidateId) === 1 && userCounts.get(input.profile.userId) === 1)
    .sort((a, b) => b.score - a.score ||
      (a.input.candidateId < b.input.candidateId ? -1 : a.input.candidateId > b.input.candidateId ? 1 : 0))
    .map(({ input }) => ({
      candidateId: input.candidateId,
      blindAlias: input.blindAlias,
      explanation: EXPLANATION,
    }));
}

/**
 * Room creation must use this outcome only after rechecking current profiles,
 * decisions and blocks atomically in the persistence layer. A one-sided like
 * never authorizes a room; a pass or exclusion prevents a match.
 */
export function resolveMutualConsent(
  a: MatchingProfile,
  b: MatchingProfile,
  aDecision: MatchDecision,
  bDecision: MatchDecision,
): MutualConsentOutcome {
  if (!isEligiblePair(a, b)) return "unavailable";
  if (!["undecided", "like", "pass"].includes(aDecision) ||
    !["undecided", "like", "pass"].includes(bDecision)) return "unavailable";
  if (aDecision === "pass" || bDecision === "pass") return "passed";
  if (aDecision === "like" && bDecision === "like") return "matched";
  return "pending";
}
