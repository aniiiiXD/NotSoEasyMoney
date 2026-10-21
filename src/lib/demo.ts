/** Legacy sample identities must never enter the real matching pool. */
export function isReservedDemoIdentity(userId: string): boolean {
  return userId.startsWith("demo:") || userId.startsWith("sample:");
}

export function sameMatchingPool(viewerId: string, targetId: string): boolean {
  return !isReservedDemoIdentity(viewerId) && !isReservedDemoIdentity(targetId);
}
