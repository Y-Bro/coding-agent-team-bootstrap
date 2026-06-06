import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BrokerAuthProvider, InProcessSecret, bearerToken, bearerHeader, authorize,
} from "../../../src/a2a/http/auth.ts";
import type { Clock } from "../../../src/ports/clock.ts";
import { SeqIds } from "../../ports/fakes.ts";

/** Advanceable clock for deterministic expiry tests. */
class MutableClock implements Clock {
  constructor(private ms = 0) {}
  advance(ms: number): void { this.ms += ms; }
  now(): Date { return new Date(this.ms); }
  isoNow(): string { return new Date(this.ms).toISOString(); }
}

test("BrokerAuthProvider issues a token per agent and validates it back to the agent", () => {
  const auth = new BrokerAuthProvider(new SeqIds());
  const tok = auth.issueToken("fe-writer");
  assert.equal(auth.validate(tok), "fe-writer");
  assert.equal(auth.validate("bogus"), null);
});

test("distinct agents get distinct tokens", () => {
  const auth = new BrokerAuthProvider(new SeqIds());
  assert.notEqual(auth.issueToken("a"), auth.issueToken("b"));
});

test("bearerHeader / bearerToken round-trip the Authorization header", () => {
  const headers = bearerHeader("t123");
  assert.equal(headers.authorization, "Bearer t123");
  assert.equal(bearerToken(headers), "t123");
  assert.equal(bearerToken({ Authorization: "Bearer T" }), "T"); // case-insensitive key
  assert.equal(bearerToken({}), null);
  assert.equal(bearerToken(undefined), null);
  assert.equal(bearerToken({ authorization: "Basic x" }), null);
});

test("authorize accepts a valid bearer and reports the agent", () => {
  const auth = new BrokerAuthProvider(new SeqIds());
  const tok = auth.issueToken("lead");
  const ok = authorize(bearerHeader(tok), auth);
  assert.deepEqual(ok, { ok: true, agentId: "lead" });
});

test("authorize rejects a missing or invalid bearer", () => {
  const auth = new BrokerAuthProvider(new SeqIds());
  assert.equal(authorize({}, auth).ok, false);
  assert.equal(authorize(bearerHeader("nope"), auth).ok, false);
});

// ---- v3-m5 hardening: expiry, rotation, secret source, back-compat ----

test("a non-expired token is accepted; an EXPIRED token is rejected (clock advanced past ttl)", () => {
  const clock = new MutableClock(1_000);
  const auth = new BrokerAuthProvider(new SeqIds(), { clock, secret: new InProcessSecret("s3cret"), ttlMs: 5_000 });
  const tok = auth.issueToken("fe-writer");
  clock.advance(4_000); // still within ttl
  assert.equal(auth.validate(tok), "fe-writer");
  clock.advance(2_000); // now past ttl (6s > 5s)
  assert.equal(auth.validate(tok), null);
});

test("rotation invalidates the previously-issued token (old rejected, new accepted)", () => {
  const auth = new BrokerAuthProvider(new SeqIds(), { secret: new InProcessSecret("s3cret") });
  const old = auth.issueToken("reviewer");
  assert.equal(auth.validate(old), "reviewer");
  const fresh = auth.rotate("reviewer");
  assert.notEqual(fresh, old);
  assert.equal(auth.validate(old), null);       // old no longer verifies
  assert.equal(auth.validate(fresh), "reviewer"); // new verifies
});

test("a secret source derives opaque tokens that don't leak the id sequence", () => {
  const a = new BrokerAuthProvider(new SeqIds(), { secret: new InProcessSecret("k1") });
  const tok = a.issueToken("x");
  assert.match(tok, /^[0-9a-f]{64}$/); // HMAC-SHA256 hex, not "tok1"
});

test("back-compat: with no clock/secret/ttl configured, behavior is exactly v2 (no expiry)", () => {
  const auth = new BrokerAuthProvider(new SeqIds());
  const tok = auth.issueToken("a");
  assert.equal(tok, "tok1");                 // opaque sequential id, as in v2
  assert.equal(auth.validate(tok), "a");     // never expires (no clock)
  // rotation still works structurally even without hardening deps
  const fresh = auth.rotate("a");
  assert.equal(auth.validate(tok), null);
  assert.equal(auth.validate(fresh), "a");
});
