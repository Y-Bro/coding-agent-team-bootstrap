import type { AgentCard } from "../a2a/index.ts";

export class AgentRegistry {
  private byId = new Map<string, AgentCard>();

  register(card: AgentCard): void { this.byId.set(card.id, card); }
  has(id: string): boolean { return this.byId.has(id); }
  get(id: string): AgentCard | undefined { return this.byId.get(id); }
  all(): AgentCard[] { return [...this.byId.values()]; }
}
