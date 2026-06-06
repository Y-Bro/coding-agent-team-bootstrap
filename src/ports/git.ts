import { execFileSync } from "node:child_process";

export interface GitCommands {
  run(args: string[], cwd?: string): string;
}

export class NodeGit implements GitCommands {
  run(args: string[], cwd?: string): string { return execFileSync("git", args, { encoding: "utf8", cwd }); }
}
