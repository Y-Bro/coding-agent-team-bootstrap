import { test } from "node:test";
import assert from "node:assert/strict";
import { StaticDiscovery, NoopDiscovery, agentUrls, staticDiscoveryFromConfig, stampUrl } from "../../src/a2a/discovery.ts";
import { TeamConfigSchema, type TeamConfig } from "../../src/config/schema.ts";
import type { AgentCard } from "../../src/a2a/index.ts";

function cfg(over: Record<string, unknown>): TeamConfig {
  return TeamConfigSchema.parse({
    name: "t", runtime: "servers",
    engines: { srv: { command: "x", roleFile: "AGENTS.md", kind: "server" } },
    ...over,
  });
}

test("StaticDiscovery resolves known ids and returns undefined otherwise", () => {
  const d = new StaticDiscovery(new Map([["a", "http://a.local:1"]]));
  assert.equal(d.resolve("a"), "http://a.local:1");
  assert.equal(d.resolve("ghost"), undefined);
});

test("NoopDiscovery resolves nothing (dynamic-discovery stub)", () => {
  assert.equal(NoopDiscovery.resolve("anyone"), undefined);
});

test("agentUrls: explicit url wins; else scheme://host:port (per-agent host/port override)", () => {
  const c = cfg({
    servers: { host: "10.0.0.1", basePort: 5000, auth: false },
    agents: [
      { id: "a", role: "writer", engine: "srv" },                                   // default host+port
      { id: "b", role: "reviewer", engine: "srv", host: "10.0.0.9", port: 9001 },   // per-agent override
      { id: "c", role: "lead", engine: "srv", url: "https://c.example.com:8443" },  // explicit url wins
    ],
  });
  const urls = agentUrls(c);
  assert.equal(urls.get("a"), "http://10.0.0.1:5000");
  assert.equal(urls.get("b"), "http://10.0.0.9:9001");
  assert.equal(urls.get("c"), "https://c.example.com:8443");
});

test("stampUrl resolves a card's reachable url from config (config -> Agent Card)", () => {
  const c = cfg({
    servers: { host: "10.0.0.1", basePort: 5000, auth: false },
    agents: [
      { id: "a", role: "writer", engine: "srv" },
      { id: "b", role: "reviewer", engine: "srv", url: "https://b.remote:8443" },
    ],
  });
  const d = staticDiscoveryFromConfig(c);
  const bare = (id: string): AgentCard => ({
    id, role: "writer", cli: "claude", engine: "srv", capabilities: [], skills: [], workdir: ".", subscribes: [],
  });
  assert.equal(stampUrl(d, bare("a")).url, "http://10.0.0.1:5000");
  assert.equal(stampUrl(d, bare("b")).url, "https://b.remote:8443");
  // an explicit card url is preserved, not overwritten
  assert.equal(stampUrl(d, { ...bare("a"), url: "https://override:1" }).url, "https://override:1");
});

test("agentUrls: scheme is https when TLS is configured", () => {
  const c = cfg({
    servers: { host: "host.local", basePort: 6000, auth: false, tls: { cert: "c.pem", key: "k.pem" } },
    agents: [{ id: "a", role: "writer", engine: "srv" }],
  });
  assert.equal(staticDiscoveryFromConfig(c).resolve("a"), "https://host.local:6000");
});
