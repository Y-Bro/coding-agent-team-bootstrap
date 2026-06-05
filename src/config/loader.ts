import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { TeamConfigSchema, type TeamConfig } from "./schema.ts";

export function loadConfig(path: string): TeamConfig {
  const raw = parse(readFileSync(path, "utf8"));
  const result = TeamConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`invalid team config (${path}):\n${result.error.message}`);
  }
  return result.data;
}
