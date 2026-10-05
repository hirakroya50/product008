import { read, write } from "../common";
import { developer } from "./developer";
import { tester, type TestRecord } from "./tester";
export async function fixer(id: string) {
  let record = read<TestRecord>(id, "test-record.json");
  const attempts = [];
  while (record.status !== "passed" && record.cycle < 3) {
    await developer(id, true);
    record = tester(id, record.cycle + 1);
    attempts.push({ cycle: record.cycle, status: record.status });
  }
  write(id, "cycles.json", { maxCycles: 3, attempts, status: record.status });
  if (record.status !== "passed")
    throw new Error("Fixer exhausted 3 cycles; human intervention required");
  return record;
}
