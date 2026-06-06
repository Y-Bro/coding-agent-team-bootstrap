import { execFileSync } from "node:child_process";

export interface TmuxCommands {
  run(args: string[]): string;
}

export class NodeTmux implements TmuxCommands {
  run(args: string[]): string { return execFileSync("tmux", args, { encoding: "utf8" }); }
}
