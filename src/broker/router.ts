import type { AgentDirectory } from "./registry.ts";
import { trace } from "../obs/trace.ts";

/** Narrow contract for resolving a `to`/`type` pair to recipient agent ids. */
export interface MessageRouter {
  resolve(to: string, type: string): string[];
}

/**
 * Resolve a message `to` field (agent id | role | capability) plus the
 * message `type` into the set of recipient agent ids. Subscribers of the
 * type are always included. Throws if nothing matches.
 */
export class Router implements MessageRouter {
  constructor(private registry: AgentDirectory) {}

  resolve(to: string, type: string): string[] {
    const agents = this.registry.all();
    const recipients = new Set<string>();

    if (this.registry.has(to)) recipients.add(to);          // direct by id
    for (const a of agents) {
      if (a.role === to) recipients.add(a.id);               // by role
      if (a.capabilities.includes(to)) recipients.add(a.id); // by capability
      if (a.subscribes.includes(type)) recipients.add(a.id); // by type subscription
    }
    if (recipients.size === 0) {
      throw new Error(`unknown target: ${to}`);
    }
    trace("router", `resolve to='${to}' type='${type}' → [${[...recipients].join(", ")}] (id|role|capability|subscription)`);
    return [...recipients];
  }
}
