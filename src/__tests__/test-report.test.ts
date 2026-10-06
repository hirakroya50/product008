// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  preserveTestReport,
  summarizeTestReport,
} from "../harness/test-report";
import { inspect, investigationSummary } from "../harness/investigation";
import { read, write, workDir } from "../harness/common";
const ids: string[] = [];
const criteria = [
  { id: "AC-1", description: "Use the requested shipping offer" },
];
const failedReport = {
  success: false,
  numTotalTests: 1,
  numPassedTests: 0,
  numPendingTests: 0,
  numFailedTestSuites: 1,
  testResults: [
    {
      name: "src/__tests__/issue-acceptance.test.tsx",
      status: "failed",
      assertionResults: [
        {
          fullName: "AC-1 shows the shipping offer",
          status: "failed",
          failureMessages: [
            'AssertionError: expected "$75" to be "$250"\n at issue-acceptance.test.tsx:14:20',
          ],
        },
      ],
    },
  ],
};
function fixture() {
  const id = `work-report-${randomUUID()}`;
  ids.push(id);
  write(id, "intake.json", {});
  return id;
}
afterEach(() => {
  for (const id of ids.splice(0))
    fs.rmSync(workDir(id), { recursive: true, force: true });
});
describe("failed Vitest evidence", () => {
  it("preserves assertion errors even when the Vitest command exits nonzero", () => {
    const id = fixture();
    const source = path.join(workDir(id), "sandbox-results.json");
    fs.writeFileSync(source, JSON.stringify(failedReport));
    const report = preserveTestReport(
      id,
      "acceptance",
      0,
      source,
      criteria,
      false,
    );
    expect(report.passed).toBe(false);
    expect(report.detail).toContain('expected "$75" to be "$250"');
    expect(report.detail).toContain("issue-acceptance.test.tsx:14:20");
    expect(report.failures[0].name).toBe("AC-1 shows the shipping offer");
    fs.rmSync(source);
    expect(read(id, report.artifact!)).toEqual(failedReport);
    expect(read(id, "acceptance-report.json")).toEqual(failedReport);
  });
  it("preserves malformed reports and fails closed instead of losing evidence", () => {
    const id = fixture();
    const source = path.join(workDir(id), "sandbox-results.json");
    fs.writeFileSync(source, "invalid JSON from an interrupted run");
    const report = preserveTestReport(id, "test", 2, source, criteria, true);
    expect(report.passed).toBe(false);
    expect(report.detail).toContain("invalid machine-readable");
    expect(
      fs.readFileSync(path.join(workDir(id), report.artifact!), "utf8"),
    ).toBe("invalid JSON from an interrupted run");
  });
  it("rejects suite setup failures even when all recorded assertions passed", () => {
    const report = {
      success: false,
      numFailedTestSuites: 1,
      testResults: [
        {
          name: "setup-suite",
          status: "failed",
          message: "afterEach cleanup failed",
          assertionResults: [{ fullName: "AC-1 behavior", status: "passed" }],
        },
      ],
    };
    const result = summarizeTestReport(report, criteria);
    expect(result.passed).toBe(false);
    expect(result.summary).toContain("afterEach cleanup failed");
  });
  it("identifies failed imports, skipped criteria and missing criteria", () => {
    const report = {
      testResults: [
        {
          name: "import-error",
          status: "failed",
          message: "Cannot find module ../shipping",
        },
        {
          name: "skipped",
          assertionResults: [
            { fullName: "AC-2 placeholder", status: "pending" },
          ],
        },
      ],
    };
    const result = summarizeTestReport(report, criteria);
    expect(result.passed).toBe(false);
    expect(result.summary).toContain("Cannot find module");
    expect(result.summary).toContain("Missing acceptance criteria: AC-1");
    expect(result.failures).toHaveLength(2);
  });
  it("provides manual investigation details without API calls or changing source", () => {
    const id = fixture();
    const result = summarizeTestReport(failedReport, criteria);
    write(id, "test-record.json", {
      status: "failed",
      cycle: 1,
      checks: [
        {
          name: "acceptance",
          status: "failed",
          exitCode: 1,
          report: "acceptance-report-cycle-1.json",
          failures: result.failures,
          log: result.summary,
        },
      ],
    });
    expect(inspect(id).failures[0].failures?.[0].message).toContain("$250");
    const summary = investigationSummary(
      id,
      "Repair returned unchanged source",
    );
    expect(summary).toContain("expected");
    expect(summary).toContain("candidate-cycle-1.json");
    expect(summary).toContain(`pnpm harness inspect --work ${id}`);
    expect(summary).toContain("do not weaken acceptance checks");
    expect(
      fs.readFileSync(path.join(workDir(id), "investigation.md"), "utf8"),
    ).toBe(summary);
  });
});
