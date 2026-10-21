import assert from "node:assert/strict";
import test from "node:test";
import { isSameOrigin, readJsonWithLimit, RequestBodyTooLarge } from "../src/lib/request.ts";

test("accepts the real loopback host when Next normalizes the request URL", () => {
  const request = new Request("http://localhost:3002/api/profile", {
    method: "POST", headers: { host: "127.0.0.1:3002", origin: "http://127.0.0.1:3002" },
  });
  assert.equal(isSameOrigin(request), true);
});

test("JSON size limits apply to the actual streamed bytes", async () => {
  const request = (body: string) => new Request("http://localhost/api", { method: "POST", body });
  assert.deepEqual(await readJsonWithLimit(request('{"ok":true}'), 20), { ok: true });
  await assert.rejects(readJsonWithLimit(request('"1234567890"'), 5), RequestBodyTooLarge);
  await assert.rejects(readJsonWithLimit(request('{'), 20), SyntaxError);
});

test("rejects missing or cross-origin mutations", () => {
  const request = (origin?: string) => new Request("http://localhost:3002/api/profile", {
    method: "POST", headers: { host: "127.0.0.1:3002", ...(origin ? { origin } : {}) },
  });
  assert.equal(isSameOrigin(request()), false);
  assert.equal(isSameOrigin(request("http://evil.example")), false);
  assert.equal(isSameOrigin(request("http://127.0.0.1:3003")), false);
  assert.equal(isSameOrigin(request("https://127.0.0.1:3002")), false);
});
