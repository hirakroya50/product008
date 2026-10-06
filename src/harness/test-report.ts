import fs from "node:fs";
import path from "node:path";
import { workDir } from "./common";
import type { Criterion } from "./common";
export interface TestFailure {
  file: string;
  name: string;
  status: string;
  message: string;
}
interface VitestReport {
  success?: boolean;
  numTotalTests?: number;
  numPassedTests?: number;
  numPendingTests?: number;
  numFailedTestSuites?: number;
  testResults: {
    name: string;
    status?: string;
    message?: string;
    assertionResults?: {
      fullName: string;
      status: string;
      failureMessages?: string[];
    }[];
  }[];
}
export function summarizeTestReport(value: unknown, criteria: Criterion[]) {
  const report = value as VitestReport;
  if (!report || !Array.isArray(report.testResults))
    throw new Error("Invalid Vitest report: testResults missing");
  const failures: TestFailure[] = [];
  const assertions = report.testResults.flatMap((suite) => {
    if (!Array.isArray(suite.assertionResults)) {
      failures.push({
        file: suite.name,
        name: "Suite failed to load",
        status: "failed",
        message: suite.message || "No assertion results were produced",
      });
      return [];
    }
    for (const test of suite.assertionResults) {
      if (test.status !== "passed")
        failures.push({
          file: suite.name,
          name: test.fullName,
          status: test.status,
          message:
            test.failureMessages?.join("\n") ||
            `Test was ${test.status}; skipped tests do not satisfy acceptance criteria`,
        });
    }
    if (
      suite.status === "failed" &&
      !suite.assertionResults.some((test) => test.status !== "passed")
    )
      failures.push({
        file: suite.name,
        name: "Suite error",
        status: "failed",
        message:
          suite.message || "Test suite failed outside an individual assertion",
      });
    return suite.assertionResults;
  });
  const missingCriteria = criteria
    .filter(
      (c) =>
        !assertions.some((test) =>
          new RegExp(`\\b${c.id}(?:\\s|:)`).test(test.fullName),
        ),
    )
    .map((c) => c.id);
  const passed =
    report.success !== false &&
    (report.numFailedTestSuites ?? 0) === 0 &&
    assertions.length > 0 &&
    failures.length === 0 &&
    missingCriteria.length === 0;
  const summary = [
    `Reported tests: ${report.numTotalTests ?? assertions.length}; passed: ${report.numPassedTests ?? assertions.filter((test) => test.status === "passed").length}; pending: ${report.numPendingTests ?? 0}.`,
    ...failures.map(
      (failure) =>
        `FAIL ${failure.file} :: ${failure.name} (${failure.status})\n${failure.message}`,
    ),
    ...(missingCriteria.length
      ? [`Missing acceptance criteria: ${missingCriteria.join(", ")}`]
      : []),
    ...(!passed && failures.length === 0 && missingCriteria.length === 0
      ? [
          "Vitest reported a run or suite failure; inspect the preserved JSON report.",
        ]
      : []),
  ].join("\n");
  return { passed, failures, missingCriteria, summary };
}

export function preserveTestReport(
  id: string,
  name: "test" | "acceptance",
  cycle: number,
  source: string,
  criteria: Criterion[],
  processPassed: boolean,
) {
  let artifact: string | undefined;
  try {
    const raw = fs.readFileSync(source, "utf8");
    artifact = `${name}-report-cycle-${cycle}.json`;
    fs.writeFileSync(path.join(workDir(id), artifact), raw);
    fs.writeFileSync(path.join(workDir(id), `${name}-report.json`), raw);
    const report = summarizeTestReport(JSON.parse(raw), criteria);
    return {
      passed: processPassed && report.passed,
      artifact,
      failures: report.failures,
      detail: `\n${report.summary}\nFull report: work/${id}/${artifact}`,
    };
  } catch (error) {
    return {
      passed: false,
      artifact,
      failures: [] as TestFailure[],
      detail: `\nMissing or invalid machine-readable test report: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
