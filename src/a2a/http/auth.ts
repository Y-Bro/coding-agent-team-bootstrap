import { createHmac } from "node:crypto";
import type { IdGenerator } from "../../ports/ids.ts";
import type { Clock } from "../../ports/clock.ts";

/**
 * Issues and validates per-agent bearer tokens for A2A calls. v2 scope is
 * localhost trust (Q5): tokens are opaque broker-issued strings, not mTLS.
 */
export interface AuthProvider {
  /** Issue a bearer token for an agent (broker-mediated). */
  issueToken(agentId: string): string;
  /** Validate a token; returns the agent id it was issued for, or null. */
  validate(token: string): string | null;
}

/** Re-issue an agent's token, invalidating its previous one (v3-m5 rotation). */
export interface Rotatable {
  rotate(agentId: string): string;
}

/**
 * Where the broker's token-signing secret/seed comes from (v3-m5). A port so the
 * secret is never hardcoded; the default in-process impl just holds an injected
 * value (the composition root supplies a random or configured secret).
 */
export interface SecretSource {
  get(): string;
}

/** Default in-process secret holder — value injected by the composition root. */
export class InProcessSecret implements SecretSource {
  constructor(private secret: string) {}
  get(): string { return this.secret; }
}

/**
 * OPTIONAL SEAMS — NOT IMPLEMENTED (out of LEAD DECISION Q5 scope). Declared so a
 * later milestone can drop in stronger inter-agent auth behind a typed contract
 * without reworking callers. Q5 keeps opaque bearer tokens + rotation/expiry.
 */
export interface JwtTokenSigner {
  /** STUB: sign/verify structured JWTs. Intentionally unimplemented (not JWT in Q5). */
  readonly _jwtStub?: never;
}
export interface MutualTlsAuth {
  /** STUB: authenticate peers by client certificate (mTLS). Intentionally unimplemented. */
  readonly _mtlsStub?: never;
}

const BEARER_PREFIX = "Bearer ";

/** Extract the bearer token from request headers (case-insensitive key). */
export function bearerToken(headers: Record<string, string> | undefined): string | null {
  if (!headers) return null;
  const value = headers["authorization"] ?? headers["Authorization"];
  if (!value || !value.startsWith(BEARER_PREFIX)) return null;
  return value.slice(BEARER_PREFIX.length);
}

/** Build the Authorization header for a token. */
export function bearerHeader(token: string): Record<string, string> {
  return { authorization: `${BEARER_PREFIX}${token}` };
}

/** Result of an authorization check. */
export type AuthResult = { ok: true; agentId: string } | { ok: false };

/** Validate the bearer in `headers` against `auth`. */
export function authorize(headers: Record<string, string> | undefined, auth: AuthProvider): AuthResult {
  const token = bearerToken(headers);
  if (token === null) return { ok: false };
  const agentId = auth.validate(token);
  return agentId === null ? { ok: false } : { ok: true, agentId };
}

/** Optional hardening collaborators. Each feature is OFF unless its dep is injected. */
export interface BrokerAuthOptions {
  /** Clock for expiry checks; required for `ttlMs` to take effect. */
  clock?: Clock;
  /** Signing secret source; when set, tokens are derived via HMAC (opaque, not JWT). */
  secret?: SecretSource;
  /** Token lifetime in ms; when set (with a clock), issued tokens expire. */
  ttlMs?: number;
}

interface TokenEntry { agentId: string; expiresAt?: number }

/**
 * Broker-mediated token store: issues an opaque bearer token per agent and
 * validates presented tokens back to their agent id. In-memory, localhost scope.
 *
 * v3-m5 hardening (all opt-in via injected deps — absent ⇒ exact v2 behavior, no
 * internal `new`): EXPIRY (clock + ttlMs) rejects stale tokens; ROTATION
 * invalidates an agent's previous token; a {@link SecretSource} derives token
 * strings via HMAC so they don't expose the id sequence. Validation stays an
 * opaque map lookup — NOT JWT signature verification (out of Q5 scope).
 */
export class BrokerAuthProvider implements AuthProvider, Rotatable {
  private byToken = new Map<string, TokenEntry>();
  private byAgent = new Map<string, string>();

  constructor(private ids: IdGenerator, private opts: BrokerAuthOptions = {}) {}

  issueToken(agentId: string): string {
    const token = this.opts.secret
      ? createHmac("sha256", this.opts.secret.get()).update(`${agentId}:${this.ids.next("n")}`).digest("hex")
      : this.ids.next("tok");
    const expiresAt = this.opts.clock && this.opts.ttlMs !== undefined
      ? this.opts.clock.now().getTime() + this.opts.ttlMs
      : undefined;
    this.byToken.set(token, { agentId, expiresAt });
    this.byAgent.set(agentId, token);
    return token;
  }

  /** Issue a fresh token for the agent and invalidate the previously-issued one. */
  rotate(agentId: string): string {
    const prev = this.byAgent.get(agentId);
    if (prev !== undefined) this.byToken.delete(prev);
    return this.issueToken(agentId);
  }

  validate(token: string): string | null {
    const entry = this.byToken.get(token);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && this.opts.clock && this.opts.clock.now().getTime() >= entry.expiresAt) {
      this.byToken.delete(token); // expired: drop it
      return null;
    }
    return entry.agentId;
  }
}
