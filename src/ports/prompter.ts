// src/ports/prompter.ts
import { createInterface } from "node:readline/promises";

export interface Prompter {
  ask(question: string, fallback?: string): Promise<string>;
  select(question: string, choices: string[]): Promise<string>;
  confirm(question: string, fallback?: boolean): Promise<boolean>;
}

export class NodePrompter implements Prompter {
  private rl = createInterface({ input: process.stdin, output: process.stdout });
  async ask(q: string, fallback = ""): Promise<string> {
    const a = (await this.rl.question(`${q} ${fallback ? `[${fallback}] ` : ""}`)).trim();
    return a || fallback;
  }
  async select(q: string, choices: string[]): Promise<string> {
    const list = choices.map((c, i) => `  ${i + 1}) ${c}`).join("\n");
    const a = await this.ask(`${q}\n${list}\nchoice`, "1");
    const idx = Number(a) - 1;
    return choices[idx] ?? choices[0] ?? "";
  }
  async confirm(q: string, fallback = true): Promise<boolean> {
    const a = (await this.ask(`${q} (y/n)`, fallback ? "y" : "n")).toLowerCase();
    return a.startsWith("y");
  }
  close() { this.rl.close(); }
}

export class ScriptedPrompter implements Prompter {
  constructor(private answers: string[]) {}
  private next(): string {
    const a = this.answers.shift();
    if (a === undefined) throw new Error("ScriptedPrompter ran out of answers");
    return a;
  }
  async ask(_question?: string, _fallback?: string): Promise<string> { return this.next(); }
  async select(_question?: string, _choices?: string[]): Promise<string> { return this.next(); }
  async confirm(_question?: string, _fallback?: boolean): Promise<boolean> { return this.next().toLowerCase().startsWith("y"); }
}
