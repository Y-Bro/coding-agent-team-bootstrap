import type { Prompter } from "../ports/prompter.ts";

export const LAYOUTS = ["even-horizontal", "even-vertical", "tiled", "main-vertical"] as const;
export type Layout = (typeof LAYOUTS)[number];

export interface PlanAgent { id: string; role: string; engine: string; }

export interface LayoutPlan {
  windowByAgent: Record<string, string>;
  layoutByWindow: Record<string, Layout>;
}

/**
 * Interactively gathers the tmux window each agent lives in (default = agent id)
 * and, for any window holding ≥2 agents, the layout to apply. Solo windows get
 * no layout prompt. Pane order follows agent order; depends only on a Prompter.
 */
export class LayoutPlanner {
  constructor(private prompter: Prompter) {}

  async plan(agents: PlanAgent[]): Promise<LayoutPlan> {
    const windowByAgent: Record<string, string> = {};
    for (const a of agents) {
      windowByAgent[a.id] = await this.prompter.ask(`Window for ${a.id} (${a.role})?`, a.id);
    }
    // Group agents per window, preserving agent order.
    const members = new Map<string, string[]>();
    for (const a of agents) {
      const w = windowByAgent[a.id]!;
      const group = members.get(w) ?? [];
      group.push(a.id);
      members.set(w, group);
    }
    const layoutByWindow: Record<string, Layout> = {};
    for (const [w, ids] of members) {
      if (ids.length >= 2) {
        layoutByWindow[w] = (await this.prompter.select(
          `Layout for window ${w}?`, [...LAYOUTS],
        )) as Layout;
      }
    }
    return { windowByAgent, layoutByWindow };
  }
}
