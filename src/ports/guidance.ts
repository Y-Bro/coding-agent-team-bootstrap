/** What the generator needs to draft an agent's role guidance. */
export interface GuidanceRequest {
  role: string;
  id: string;
  team: string;
  engine: string;
}

/**
 * Drafts role-guidance markdown for one agent. Returns null when generation is
 * unavailable or fails — callers MUST fall back to deterministic wiring-only.
 */
export interface GuidanceGenerator {
  generate(req: GuidanceRequest): Promise<string | null>;
}
