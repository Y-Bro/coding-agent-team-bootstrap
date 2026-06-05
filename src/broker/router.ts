import type { AgentRegistry } from "./registry.ts";

/**
 * Resolve a message `to` field (agent id | role | capability) plus the
 * message `type` into the set of recipient agent ids. Subscribers of the
 * type are always included. Throws if nothing matches.
 */
export class Router {
  constructor(private registry: AgentRegistry) {}

  resolve(to: string, type: string): string[] {
    const agents = this.registry.all();
    const recipients = new Set<string>();

    if (this.registry.has(to)) recipients.add(to);
    for (const a of agents) {
      if (a.role === to) recipients.add(a.id);
      if (a.capabilities.includes(to)) recipients.add(a.id);
      if (a.subscribes.includes(type)) recipients.add(a.id);
    }
    if (recipients.size === 0) {
      throw new Error(`unknown target: ${to}`);
    }
    return [...recipients];
  }
}
