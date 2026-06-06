import type { TeamConfig } from "../config/index.ts";

/**
 * Resolve an agent id to its reachable A2A base URL (v3-m3 multi-host). A small
 * seam so dynamic discovery (a registry service, DNS-SD, …) can drop in later;
 * the default is {@link StaticDiscovery} built from config. `resolve` returns
 * undefined for an unknown agent (callers fall back to a sensible default).
 */
export interface DiscoveryProvider {
  resolve(agentId: string): string | undefined;
}

/** Static, config-driven discovery: a fixed id → URL map. */
export class StaticDiscovery implements DiscoveryProvider {
  constructor(private urls: Map<string, string>) {}
  resolve(agentId: string): string | undefined { return this.urls.get(agentId); }
}

/** No-op discovery seam (resolves nothing) — the stub for "dynamic discovery". */
export const NoopDiscovery: DiscoveryProvider = { resolve: () => undefined };

/**
 * Each agent's reachable A2A base URL from config: an explicit `url` wins; else
 * `scheme://(agent.host ?? servers.host):(agent.port ?? basePort+index)`, where
 * the scheme is https when TLS is configured, otherwise http.
 */
export function agentUrls(cfg: TeamConfig): Map<string, string> {
  const scheme = cfg.servers.tls ? "https" : "http";
  return new Map(cfg.agents.map((a, i) => {
    const url = a.url ?? `${scheme}://${a.host ?? cfg.servers.host}:${a.port ?? cfg.servers.basePort + i}`;
    return [a.id, url] as const;
  }));
}

/** Build the default static discovery provider from a team config. */
export function staticDiscoveryFromConfig(cfg: TeamConfig): StaticDiscovery {
  return new StaticDiscovery(agentUrls(cfg));
}
