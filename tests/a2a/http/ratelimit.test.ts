import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpRateLimitError, retryAfterMsOf, throwIfRateLimited, throwIfHttpError } from "../../../src/a2a/http/ratelimit.ts";
import { isRateLimited } from "../../../src/runtime/servers/scheduler.ts";

test("throwIfRateLimited throws on HTTP 429 and is a no-op otherwise", () => {
  assert.doesNotThrow(() => throwIfRateLimited({ status: 200 }));
  assert.throws(() => throwIfRateLimited({ status: 429 }), HttpRateLimitError);
});

test("the thrown error is recognized by the scheduler as a 429", () => {
  let caught: unknown;
  try { throwIfRateLimited({ status: 429 }); } catch (e) { caught = e; }
  assert.equal(isRateLimited(caught), true);
});

test("throwIfHttpError throws on non-2xx (incl 404) with status+body in the message, no-op on 2xx", () => {
  assert.doesNotThrow(() => throwIfHttpError({ status: 200, body: "{}" }));
  assert.doesNotThrow(() => throwIfHttpError({ status: 299, body: "" }));
  assert.throws(() => throwIfHttpError({ status: 404, body: "missing" }), /404.*missing/);
  assert.throws(() => throwIfHttpError({ status: 500, body: "boom" }), /500.*boom/);
});

test("retryAfterMsOf parses Retry-After seconds into milliseconds (case-insensitive)", () => {
  assert.equal(retryAfterMsOf({ "retry-after": "2" }), 2000);
  assert.equal(retryAfterMsOf({ "Retry-After": "0.5" }), 500);
  assert.equal(retryAfterMsOf({}), undefined);
  assert.equal(retryAfterMsOf(undefined), undefined);
  assert.equal(retryAfterMsOf({ "retry-after": "soon" }), undefined);
});

test("throwIfRateLimited preserves Retry-After as retryAfterMs", () => {
  try { throwIfRateLimited({ status: 429, headers: { "retry-after": "3" } }); assert.fail("should throw"); }
  catch (e) { assert.equal((e as HttpRateLimitError).retryAfterMs, 3000); }
});
