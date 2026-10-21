/** Reserved identities used only by the local, disposable demo login. */
const DEMO_ID = /^demo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SAMPLE_PROFILES = [
  { key: "sage", alias: "Sage (sample)", answers: { social_setting: 2, planning_style: 3, novelty: 4, conversation_style: 4, message_frequency: 3, date_atmosphere: 2 } },
  { key: "river", alias: "River (sample)", answers: { social_setting: 4, planning_style: 4, novelty: 5, conversation_style: 2, message_frequency: 3, date_atmosphere: 4 } },
  { key: "ember", alias: "Ember (sample)", answers: { social_setting: 3, planning_style: 2, novelty: 3, conversation_style: 5, message_frequency: 2, date_atmosphere: 3 } },
] as const;

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
