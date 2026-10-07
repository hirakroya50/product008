import { read, write, fingerprint, safePath, type Draft } from "../common";
import { developer } from "./developer";
import { investigationSummary } from "../investigation";
import { tester, type TestRecord } from "./tester";
function assertRepairable(id: string, record: TestRecord) {
  if (record.checks.some((check) => check.failureKind === "provider")) {
    investigationSummary(
      id,
      "The independent review could not run because of an API/provider failure. Restore provider access before retrying; this is not an implementation defect.",
    );
    throw new Error(
      `Review provider unavailable; see work/${id}/api-failure.json and run pnpm harness inspect --work ${id}`,
    );
  }
  const runnerFailures = record.checks.filter(
    (check) =>
      check.status !== "passed" &&
      (check.exitCode === null ||
        check.exitCode === 137 ||
        Boolean(check.signal) ||
        /sandbox_apply: Operation not permitted|ETIMEDOUT/.test(check.log)),
  );
  if (runnerFailures.length) {
    investigationSummary(
      id,
      `Runner failure in ${runnerFailures.map((check) => check.name).join(", ")}: a timeout, killed process or unavailable sandbox requires runner investigation before code repair.`,
    );
    throw new Error(
      `Runner failure prevents reliable code repair. Run pnpm harness inspect --work ${id}; see work/${id}/investigation.md`,
    );
  }
  const frozenTypeErrors = record.checks.some(
    (check) =>
      check.name === "typecheck" &&
      check.status !== "passed" &&
      /src\/__tests__\/issue-acceptance\.test\.tsx\(\d+,\d+\): error TS/.test(
        check.log,
      ),
  );
  const protectedFailures = record.checks
    .flatMap((check) => check.failures ?? [])
    .filter((failure) => {
      const relative = failure.file
        .replace(/\\/g, "/")
        .match(/(?:^|\/)(src\/__tests__\/[^/]+)$/)?.[1];
      if (!relative || relative.endsWith("/issue-acceptance.test.tsx"))
        return false;
      try {
        safePath(relative);
        return false;
      } catch {
        return true;
      }
    });
  if (frozenTypeErrors || protectedFailures.length) {
    const reason = [
      ...(frozenTypeErrors
        ? [
            "The frozen acceptance contract has TypeScript errors; regenerate and validate acceptance before product repair.",
          ]
        : []),
      ...(protectedFailures.length
        ? [
            `Protected harness tests failed: ${[...new Set(protectedFailures.map((failure) => failure.name))].join("; ")}. Fix the baseline harness; product edits cannot repair these tests.`,
          ]
        : []),
    ].join(" ");
    investigationSummary(id, reason);
    throw new Error(
      `Unrepairable test infrastructure: ${reason} See work/${id}/investigation.md`,
    );
  }
}
export async function fixer(id: string) {
  let record = read<TestRecord>(id, "test-record.json");
  const draft = read<Draft>(id, "draft.json");
  assertRepairable(id, record);
  const attempts = [];
  let previousFingerprint = record.fingerprint;
  while (record.status !== "passed" && record.cycle < draft.maxCycles) {
    await developer(id, true);
    if (fingerprint() === previousFingerprint) {
      attempts.push({ cycle: record.cycle + 1, status: "no-progress" });
      investigationSummary(
        id,
        "The repair returned unchanged source. Inspect the preserved assertion errors before deciding whether product code or the independently generated test is wrong.",
      );
      write(id, "cycles.json", {
        maxCycles: draft.maxCycles,
        attempts,
        status: "blocked",
        reason: "Repair made no code changes; manual investigation required",
      });
      throw new Error(
        `Fixer made no progress. Run pnpm harness inspect --work ${id}; see work/${id}/investigation.md and preserved test reports`,
      );
    }
    record = await tester(id, record.cycle + 1);
    previousFingerprint = record.fingerprint;
    attempts.push({ cycle: record.cycle, status: record.status });
    write(id, "cycles.json", {
      maxCycles: draft.maxCycles,
      attempts,
      status: record.status,
    });
    assertRepairable(id, record);
  }
  write(id, "cycles.json", {
    maxCycles: draft.maxCycles,
    attempts,
    status: record.status,
  });
  if (record.status !== "passed") {
    investigationSummary(
      id,
      "The repair budget was exhausted. All test and source snapshots are preserved for investigation.",
    );
    throw new Error(
      `Fixer exhausted 3 cycles. Run pnpm harness inspect --work ${id}; see work/${id}/investigation.md`,
    );
  }
  return record;
}
