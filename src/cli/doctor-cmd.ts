// src/cli/doctor-cmd.ts
import type { DoctorReport } from "../bootstrap/doctor.ts";

export function formatDoctorReport(r: DoctorReport): string {
  const lines: string[] = [];
  lines.push(r.ok ? "Core tools: OK" : "Core tools: MISSING");
  for (const b of r.blockers) lines.push(`  ✗ ${b}`);
  lines.push("Engines:");
  for (const [name, present] of Object.entries(r.enginesPresent)) {
    lines.push(`  ${present ? "✓" : "✗"} ${name} ${present ? "present" : "missing"}`);
  }
  return lines.join("\n");
}
