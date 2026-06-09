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
    // Direct send: an exact agent-id target goes to that agent ONLY — no
    // type-subscriber fan-out (so `--to <spoke>` is a private message, not a
    // broadcast). Fan-out is reserved for non-id (role/capability/type) targets.
    if (this.registry.has(to)) {
      trace("router", `resolve to='${to}' → DIRECT (exact id, no fan-out)`);
      return [to];
    }

    trace("router", `resolve to='${to}' type='${type}' → BROADCAST (role/capability/type-subscriber fan-out)`);
    const recipients = new Set<string>();
    for (const a of this.registry.all()) {
      if (a.role === to) recipients.add(a.id);
      if (a.capabilities.includes(to)) recipients.add(a.id);
      if (a.subscribes.includes(type)) recipients.add(a.id); // broadcast-by-type
    }
    if (recipients.size === 0) {
      throw new Error(`unknown target: ${to}`);
    }
    trace("router", `resolve to='${to}' type='${type}' → [${[...recipients].join(", ")}] (id|role|capability|subscription)`);
    return [...recipients];
  }
}
