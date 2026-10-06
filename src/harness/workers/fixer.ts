import { read, write, fingerprint, type Draft } from "../common";
import { developer } from "./developer";
import { tester, type TestRecord } from "./tester";
export async function fixer(id: string) {
  let record = read<TestRecord>(id, "test-record.json");
  const draft = read<Draft>(id, "draft.json");
  const attempts = [];
  let previousFingerprint = record.fingerprint;
  while (record.status !== "passed" && record.cycle < draft.maxCycles) {
    await developer(id, true);
    if (fingerprint() === previousFingerprint) {
      write(id, "cycles.json", {
        maxCycles: draft.maxCycles,
        attempts,
        status: "blocked",
        reason: "Repair made no code changes; manual investigation required",
      });
      throw new Error("Fixer made no progress; manual investigation required");
    }
    record = await tester(id, record.cycle + 1);
    previousFingerprint = record.fingerprint;
    attempts.push({ cycle: record.cycle, status: record.status });
  }
  write(id, "cycles.json", {
    maxCycles: draft.maxCycles,
    attempts,
    status: record.status,
  });
  if (record.status !== "passed")
    throw new Error("Fixer exhausted 3 cycles; human intervention required");
  return record;
}
