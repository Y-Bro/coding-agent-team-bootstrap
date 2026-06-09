/**
 * Translate an HTTP 429 response into a thrown error the FleetScheduler treats as
 * a rate-limit signal. The error carries `status: 429` (recognized by the
 * scheduler's `isRateLimited`) plus an optional `retryAfterMs` parsed from the
 * `Retry-After` header, so backoff honors the server's hint when present.
 *
 * Kept in the a2a/http layer (not importing the scheduler's `RateLimitError`) so
 * the wire layer has no upward dependency on the runtime.
 */
export class HttpRateLimitError extends Error {
  readonly status = 429;
  constructor(public readonly retryAfterMs?: number) {
    super("rate limited (HTTP 429)");
    this.name = "HttpRateLimitError";
  }
}

/** Parse a `Retry-After` header (delay in seconds) into ms; undefined if absent/non-numeric. */
export function retryAfterMsOf(headers?: Record<string, string>): number | undefined {
  if (!headers) return undefined;
  let raw: string | undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "retry-after") { raw = v; break; }
  }
  if (raw === undefined) return undefined;
  const secs = Number(raw);
  return Number.isFinite(secs) ? secs * 1000 : undefined;
}

/** Throw an {@link HttpRateLimitError} when the response is an HTTP 429; no-op otherwise. */
export function throwIfRateLimited(res: { status: number; headers?: Record<string, string> }): void {
  if (res.status === 429) throw new HttpRateLimitError(retryAfterMsOf(res.headers));
}

/**
 * Throw a structured error on any non-2xx response so callers fail loudly with the
 * status + a body excerpt instead of a misleading `JSON.parse` error on an error
 * page. Call AFTER {@link throwIfRateLimited} so 429 backoff is unaffected.
 */
export function throwIfHttpError(res: { status: number; body: string }): void {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 200)}`);
  }
}
