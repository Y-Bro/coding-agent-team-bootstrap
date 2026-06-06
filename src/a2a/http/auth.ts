import type { IdGenerator } from "../../ports/ids.ts";

/**
 * Issues and validates per-agent bearer tokens for A2A calls. v2 scope is
 * localhost trust (Q5): tokens are opaque broker-issued strings, not mTLS.
 */
export interface AuthProvider {
  /** Issue a bearer token for an agent (broker-mediated). */
  issue(agentId: string): string;
  /** Validate a token; returns the agent id it was issued for, or null. */
  validate(token: string): string | null;
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

/**
 * Broker-mediated token store: the broker issues an opaque token per agent and
 * validates presented tokens back to their agent id. In-memory, localhost scope.
 */
export class BrokerAuthProvider implements AuthProvider {
  private byToken = new Map<string, string>();

  constructor(private ids: IdGenerator) {}

  issue(agentId: string): string {
    const token = this.ids.next("tok");
    this.byToken.set(token, agentId);
    return token;
  }

  validate(token: string): string | null {
    return this.byToken.get(token) ?? null;
  }
}
