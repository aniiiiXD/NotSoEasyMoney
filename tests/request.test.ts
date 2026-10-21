import assert from "node:assert/strict";
import test from "node:test";
import { isSameOrigin } from "../src/lib/request.ts";

test("accepts the real loopback host when Next normalizes the request URL", () => {
  const request = new Request("http://localhost:3002/api/profile", {
    method: "POST", headers: { host: "127.0.0.1:3002", origin: "http://127.0.0.1:3002" },
  });
  assert.equal(isSameOrigin(request), true);
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
