import { randomUUID } from "node:crypto";

export function localDemoEnabled(): boolean {
  return process.env.NODE_ENV === "development" && Boolean(process.env.AUTH_SECRET);
}

export function isLoopbackHost(host: string | null): boolean {
  return Boolean(host && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host));
}

// The demo creates a disposable identity only for requests to this machine.
export function authorizeDemo(request: Request): { id: string } | null {
  if (!localDemoEnabled() || !isLoopbackHost(request.headers.get("host"))) return null;
  try {
    const hostname = new URL(request.url).hostname.toLowerCase();
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return null;
    return { id: `demo:${randomUUID()}` };
  } catch {
    return null;
  }
}
