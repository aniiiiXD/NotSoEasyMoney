import { NextRequest } from "next/server.js";

class LocalRequest extends NextRequest {
  private readonly localUrl: string;

  constructor(url: URL, request: NextRequest) {
    super(url, request);
    this.localUrl = url.href;
  }

  get url() { return this.localUrl; }
}

// Next.js normalizes loopback request URLs to localhost in development. Keep
// the browser's actual loopback host for Auth.js callback and host-only cookies.
export function withLocalOrigin(request: NextRequest): NextRequest {
  if (process.env.NODE_ENV !== "development") return request;
  const host = request.headers.get("host");
  if (!host || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(host)) return request;
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return request;
  url.host = host;
  return new LocalRequest(url, request);
}
