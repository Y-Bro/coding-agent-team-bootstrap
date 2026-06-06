import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BrokerAuthProvider, bearerToken, bearerHeader, authorize,
} from "../../../src/a2a/http/auth.ts";
import { SeqIds } from "../../ports/fakes.ts";

test("BrokerAuthProvider issues a token per agent and validates it back to the agent", () => {
  const auth = new BrokerAuthProvider(new SeqIds());
  const tok = auth.issue("fe-writer");
  assert.equal(auth.validate(tok), "fe-writer");
  assert.equal(auth.validate("bogus"), null);
});

test("distinct agents get distinct tokens", () => {
  const auth = new BrokerAuthProvider(new SeqIds());
  assert.notEqual(auth.issue("a"), auth.issue("b"));
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
  const tok = auth.issue("lead");
  const ok = authorize(bearerHeader(tok), auth);
  assert.deepEqual(ok, { ok: true, agentId: "lead" });
});

test("authorize rejects a missing or invalid bearer", () => {
  const auth = new BrokerAuthProvider(new SeqIds());
  assert.equal(authorize({}, auth).ok, false);
  assert.equal(authorize(bearerHeader("nope"), auth).ok, false);
});
