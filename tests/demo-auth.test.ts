import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeDemo, isLoopbackHost, localDemoEnabled } from "../src/app/sign-in/demo.ts";

const environment: Record<string, string | undefined> = process.env;

function inEnvironment(nodeEnv: string, secret: string | undefined, run: () => void) {
  const previousEnv = environment.NODE_ENV;
  const previousSecret = environment.AUTH_SECRET;
  environment.NODE_ENV = nodeEnv;
  if (secret === undefined) delete environment.AUTH_SECRET; else environment.AUTH_SECRET = secret;
  try { run(); }
  finally {
    if (previousEnv === undefined) delete environment.NODE_ENV; else environment.NODE_ENV = previousEnv;
    if (previousSecret === undefined) delete environment.AUTH_SECRET; else environment.AUTH_SECRET = previousSecret;
  }
}

function request(url: string, host?: string) {
  return new Request(url, { headers: host ? { host } : {} });
}

test("local demo issues a fresh demo identity for every login", () => {
  inEnvironment("development", "local-test-secret", () => {
    assert.equal(localDemoEnabled(), true);
    const first = authorizeDemo(request("http://localhost:3000/api/auth/callback/demo", "127.0.0.1:3000"));
    const second = authorizeDemo(request("http://localhost:3000/api/auth/callback/demo", "127.0.0.1:3000"));
    assert.match(first?.id ?? "", /^demo:[0-9a-f-]{36}$/);
    assert.match(second?.id ?? "", /^demo:[0-9a-f-]{36}$/);
    assert.notEqual(first?.id, second?.id);
  });
});

test("demo refuses production, missing secrets, and non-loopback hosts", () => {
  const local = request("http://localhost:3000/api/auth/callback/demo", "localhost:3000");
  inEnvironment("production", "local-test-secret", () => assert.equal(authorizeDemo(local), null));
  inEnvironment("development", undefined, () => assert.equal(authorizeDemo(local), null));
  inEnvironment("development", "local-test-secret", () => {
    assert.equal(authorizeDemo(request("http://localhost:3000/api/auth/callback/demo", "example.com")), null);
    assert.equal(authorizeDemo(request("https://example.com/api/auth/callback/demo", "localhost:3000")), null);
    assert.equal(authorizeDemo(request("http://localhost:3000/api/auth/callback/demo")), null);
    for (const host of ["localhost.evil.test", "127.0.0.1.evil.test", "evil.test:3000", "localhost:3000@evil.test"]) {
      assert.equal(isLoopbackHost(host), false);
    }
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      assert.equal(isLoopbackHost(host), true);
    }
  });
});
