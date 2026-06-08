import { spawn } from "node:child_process";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

/** Runs a command to completion, capturing output, with a hard timeout. */
export interface CommandRunner {
  run(command: string, args: string[], opts: CommandOptions): Promise<CommandResult>;
}

export class NodeCommandRunner implements CommandRunner {
  run(command: string, args: string[], opts: CommandOptions): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve) => {
      const child = spawn(command, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      const timer = opts.timeoutMs
        ? setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, opts.timeoutMs)
        : undefined;
      child.on("error", () => {
        if (timer) clearTimeout(timer);
        resolve({ code: null, stdout, stderr, timedOut });
      });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut });
      });
    });
  }
}

export class FakeCommandRunner implements CommandRunner {
  readonly calls: { command: string; args: string[] }[] = [];
  constructor(private result: CommandResult) {}
  async run(command: string, args: string[], _opts: CommandOptions): Promise<CommandResult> {
    this.calls.push({ command, args });
    return this.result;
  }
}
