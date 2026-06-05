import { randomUUID } from "node:crypto";

export interface IdGenerator {
  next(prefix?: string): string;
}

export class UuidGenerator implements IdGenerator {
  next(prefix = "m"): string { return `${prefix}_${randomUUID()}`; }
}
