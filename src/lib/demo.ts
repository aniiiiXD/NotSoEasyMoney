import { answersInOrder } from "./personality.ts";

/** Reserved identities used only by the local, disposable demo login. */
const DEMO_ID = /^demo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Answers follow QUESTION_IDS order: seven Mini-IPIP items for extraversion and
// agreeableness, then conscientiousness, neuroticism, imagination, and the three
// OkCupid questions. Each sample is written to fit its description in the demo.
export const SAMPLE_PROFILES = [
  { key: "sage", alias: "Sage (sample)", answers: answersInOrder([2, 3, 3, 3, 5, 4, 1, 3, 4, 2, 2, 2, 2, 4, 4, 5, 1, 2, 4, 3]) },
  { key: "river", alias: "River (sample)", answers: answersInOrder([5, 5, 1, 1, 3, 3, 2, 2, 2, 4, 3, 3, 2, 4, 3, 4, 2, 5, 5, 5]) },
  { key: "ember", alias: "Ember (sample)", answers: answersInOrder([1, 2, 4, 5, 5, 5, 1, 4, 5, 2, 1, 3, 3, 3, 3, 4, 1, 1, 2, 1]) },
] as const;

/** Sample answers for the demo viewer, shared by the landing page, demo, and join form. */
export const SAMPLE_VIEWER_ANSWERS = answersInOrder([3, 4, 2, 3, 4, 4, 2, 3, 4, 3, 2, 2, 2, 4, 4, 4, 2, 2, 4, 3]);

export function isDemoViewer(userId: string): boolean {
  return DEMO_ID.test(userId);
}

export function isReservedDemoIdentity(userId: string): boolean {
  return userId.startsWith("demo:") || userId.startsWith("sample:");
}

export function sampleId(viewerId: string, key: string): string {
  return `sample:${viewerId}:${key}`;
}

export function isSampleForViewer(viewerId: string, targetId: string): boolean {
  return isDemoViewer(viewerId) && SAMPLE_PROFILES.some(({ key }) => sampleId(viewerId, key) === targetId);
}

/** Demo and regular accounts must never enter the same candidate pool. */
export function sameMatchingPool(viewerId: string, targetId: string): boolean {
  if (isDemoViewer(viewerId)) return isSampleForViewer(viewerId, targetId);
  return !isReservedDemoIdentity(viewerId) && !isReservedDemoIdentity(targetId);
}
