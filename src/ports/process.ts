import { spawn, type ChildProcess } from "node:child_process";

/** A handle to a spawned long-running process. */
export interface ProcessHandle {
  /** Gracefully stop the process (SIGTERM); resolves once it has exited. */
  kill(): Promise<void>;
}

/** Seam for launching engine processes so the servers runtime tests headlessly. */
export interface ProcessSpawner {
  spawn(command: string, opts: { args?: string[]; env?: Record<string, string>; cwd?: string }): ProcessHandle;
}

export class NodeProcessSpawner implements ProcessSpawner {
  spawn(command: string, opts: { args?: string[]; env?: Record<string, string>; cwd?: string }): ProcessHandle {
    const child: ChildProcess = spawn(command, opts.args ?? [], {
      env: { ...process.env, ...(opts.env ?? {}) },
      cwd: opts.cwd,
      stdio: "inherit",
    });
    return {
      kill: () => new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
    };
  }
}
