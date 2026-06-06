import type { Runtime } from "./runtime.ts";

/** v1 seam only — proves the interface; real HTTP A2A deferred to v2. */
export class ServersRuntime implements Runtime {
  async spawn(): Promise<void> { throw new Error("ServersRuntime not implemented in v1"); }
  async wake(): Promise<void> { throw new Error("ServersRuntime not implemented in v1"); }
  async teardown(): Promise<void> { throw new Error("ServersRuntime not implemented in v1"); }
}
