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

export class RequestBodyTooLarge extends Error {}

/** Read JSON with a byte limit, even when Content-Length is missing or false. */
export async function readJsonWithLimit(request: Request, limit: number): Promise<unknown> {
  if (!request.body) throw new SyntaxError("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new RequestBodyTooLarge(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
