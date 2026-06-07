import type { Clock } from "../ports/clock.ts";
import type { Sleeper } from "../ports/sleeper.ts";

/** A single liveness check evaluated once per sweep tick. Extend the sweep by
 * adding implementations — never by editing the loop. */
export interface SweepPolicy {
  run(now: Date): void;
}

export interface SweepDeps {
  clock: Clock;
  sleeper: Sleeper;
  intervalMs: number;
  policies: SweepPolicy[];
}

/** Clock/Sleeper-driven loop that evaluates policies on a fixed cadence. Tests
 * drive `tick()` against a fake clock; production calls `start()`. */
export class SweepLoop {
  private running = false;
  constructor(private deps: SweepDeps) {}

  tick(): void {
    const now = this.deps.clock.now();
    for (const p of this.deps.policies) p.run(now);
  }

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      this.tick();
      await this.deps.sleeper.sleep(this.deps.intervalMs);
    }
  }

  stop(): void { this.running = false; }
}
