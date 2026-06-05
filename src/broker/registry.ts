import type { AgentCard } from "../a2a/index.ts";

/** Narrow contract for looking up and registering agent cards. */
export interface AgentDirectory {
  register(card: AgentCard): void;
  has(id: string): boolean;
  get(id: string): AgentCard | undefined;
  all(): AgentCard[];
}

export class AgentRegistry implements AgentDirectory {
  private byId = new Map<string, AgentCard>();

  register(card: AgentCard): void { this.byId.set(card.id, card); }
  has(id: string): boolean { return this.byId.has(id); }
  get(id: string): AgentCard | undefined { return this.byId.get(id); }
  all(): AgentCard[] { return [...this.byId.values()]; }
}
