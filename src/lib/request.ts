/** Validate the browser Origin of a state-changing request against its Host. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    // Next's local dev server can normalize request.url to localhost even when
    // the browser used 127.0.0.1. The incoming Host preserves the real origin.
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
    const protocol = forwardedProtocol || new URL(request.url).protocol.slice(0, -1);
    return (protocol === "http" || protocol === "https") &&
      parsed.protocol === `${protocol}:` && parsed.host.toLowerCase() === host.toLowerCase() && parsed.origin === origin;
  } catch {
    return false;
  }
}
