import fs from "node:fs";
import path from "node:path";
import { read, workDir } from "./common";
import type { TestRecord } from "./workers/tester";

export function inspect(id: string) {
  const providerFile = path.join(workDir(id), "api-failure.json");
  const provider = fs.existsSync(providerFile)
    ? read<{ action: string; message: string; kind: string }>(
        id,
        "api-failure.json",
      )
    : undefined;
  const recordFile = path.join(workDir(id), "test-record.json");
  if (!fs.existsSync(recordFile)) {
    const progressFile = path.join(workDir(id), "test-progress.json");
    const progress = fs.existsSync(progressFile)
      ? read<{
          cycle: number;
          status?: string;
          currentCheck?: string;
          completedChecks: { name: string; status: string }[];
        }>(id, "test-progress.json")
      : undefined;
    return {
      workId: id,
      status: provider
        ? "failed"
        : (progress?.status ??
          (progress?.currentCheck ? "running" : "unknown")),
      cycle: progress?.cycle ?? 0,
      checks: progress?.completedChecks ?? [],
      failures: provider
        ? [
            {
              check: "api",
              report: undefined,
              failures: undefined,
              log: provider.message + "\n" + provider.action,
            },
          ]
        : [],
      artifacts: [
        `work/${id}/api-failure.json`,
        `work/${id}/acceptance-generation-*.json`,
      ],
      provider,
    };
  }
  const record = read<TestRecord>(id, "test-record.json");
  const failed = record.checks.filter((check) => check.status !== "passed");
  return {
    provider,
    workId: id,
    status: record.status,
    cycle: record.cycle,
    checks: record.checks.map((check) => ({
      name: check.name,
      status: check.status,
    })),
    failures: failed.map((check) => ({
      check: check.name,
      report: check.report,
      failures: check.failures,
      log: check.log,
    })),
    artifacts: [
      `work/${id}/candidate-cycle-${record.cycle}.json`,
      `work/${id}/acceptance-tests.json`,
      `work/${id}/test-cycle-${record.cycle}.json`,
      `work/${id}/cycles.json`,
    ],
  };
}
export function investigationSummary(id: string, reason: string) {
  const info = inspect(id);
  const dir = workDir(id);
  const summary = `## Pipeline stopped: issue investigation
Work record: \`${id}\`. Last test cycle: ${info.cycle}.

${reason}

### Failed checks
${info.failures.map((check) => `#### ${check.check}\n${check.report ? `Full report: \`work/${id}/${check.report}\`\n` : ""}\n\`\`\`text\n${check.log.slice(0, 20000).replace(/\x60{3}/g, "'''")}\n\`\`\``).join("\n\n")}

### Manual investigation
1. Download this run's \`product008-issue-…\` artifact from the Actions run page.
2. Open \`work/${id}/test-record.json\` and the referenced \`test-report-cycle-*.json\` / \`acceptance-report-cycle-*.json\`. Read each failing test's name, expected/actual result and stack trace.
3. Compare \`acceptance-tests.json\`, \`candidate-cycle-${info.cycle}.json\`, \`candidate-cycle-${info.cycle}.patch\`, \`source-backup.json\` and \`draft.json\`. These preserve the independent tests, tested source, diff and original source. New files are included in the source snapshot even if absent from the diff.
4. In a disposable checkout of the run's base revision, restore the candidate source snapshot and place the acceptance code at \`src/__tests__/issue-acceptance.test.tsx\`. Run \`pnpm typecheck\` and \`pnpm exec vitest run src/__tests__/issue-acceptance.test.tsx\` to reproduce the assertion. Use \`pnpm test\` for regressions. Do not apply the snapshot over your normal working checkout.
5. Repair product code when it violates the issue. If the independent test itself misreads the requirement or uses an invalid fixture/API, correct test generation and start a fresh run; do not weaken acceptance checks just to make the run green.
6. Push the harness/code correction to the default branch, then use Run workflow with the same issue number. A failed candidate has not been pushed as a PR.

After extracting the artifact under a checkout containing the harness, \`pnpm harness inspect --work ${id}\` prints the saved failure details without making API calls or changing source.
`;
  fs.writeFileSync(path.join(dir, "investigation.md"), summary);
  return summary;
}
