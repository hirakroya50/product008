import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { root, write, type Criterion, type Issue } from "./common";
import { acceptancePath, type AcceptanceTests } from "./quality";
import { summarizeTestReport, type TestFailure } from "./test-report";
import { shippingRequest } from "./shipping-request";

export interface PreflightCheck {
  name: string;
  exitCode: number;
  log: string;
}
export interface PreflightFailure extends TestFailure {
  id: string;
  scenario: string;
}
export interface AcceptancePreflight {
  blockers: string[];
  checks: PreflightCheck[];
  failures: PreflightFailure[];
  probe?: { path: string; threshold: number };
}

// A diagnostic probe, never a product patch: exposes assertions hidden behind
// earlier failures for the old threshold (e.g. the issue 21 progress assertion).
export function thresholdProbe(source: string, issue: Issue) {
  const request = shippingRequest(issue);
  const declaration =
    /export const FREE_SHIPPING_THRESHOLD\s*=\s*\d+(?:\.\d+)?\s*;/;
  if (request?.kind !== "threshold" || !declaration.test(source)) return null;
  return {
    threshold: request.threshold,
    source: source.replace(
      declaration,
      `export const FREE_SHIPPING_THRESHOLD = ${request.threshold};`,
    ),
  };
}

export function acceptancePreflight(
  id: string,
  attempt: number,
  tests: AcceptanceTests,
  criteria: Criterion[],
  issue: Issue,
): AcceptancePreflight {
  if (process.platform !== "darwin" || !fs.existsSync("/usr/bin/sandbox-exec"))
    throw new Error("Acceptance preflight requires the macOS sandbox runner");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "product008-acceptance-"));
  const result: AcceptancePreflight = {
    blockers: [],
    checks: [],
    failures: [],
  };
  try {
    for (const file of [
      "src",
      "docs",
      "README.md",
      "public",
      "index.html",
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig.json",
      "vite.config.ts",
    ])
      fs.cpSync(path.join(root, file), path.join(dir, file), {
        recursive: true,
      });
    const modules = path.join(dir, "node_modules");
    fs.mkdirSync(modules);
    for (const entry of fs.readdirSync(path.join(root, "node_modules"))) {
      if ([".vite", ".vite-temp", ".cache"].includes(entry)) continue;
      fs.symlinkSync(
        path.join(root, "node_modules", entry),
        path.join(modules, entry),
      );
    }
    fs.writeFileSync(path.join(dir, acceptancePath), tests.code);
    const profile = `(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath ${JSON.stringify(fs.realpathSync(dir))}))(allow file-write* (literal "/dev/null"))`;
    function execute(name: string, args: string[]) {
      process.stderr.write(
        `Acceptance attempt ${attempt + 1}: ${name} (180s limit)\n`,
      );
      const run = spawnSync(
        "/usr/bin/sandbox-exec",
        ["-p", profile, "pnpm", ...args],
        {
          cwd: dir,
          env: {
            PATH: process.env.PATH,
            HOME: dir,
            TMPDIR: dir,
            CI: "true",
            NO_COLOR: "1",
            NODE_OPTIONS: "--max-old-space-size=512",
            GOMAXPROCS: "2",
            GOMEMLIMIT: "256MiB",
          },
          encoding: "utf8",
          timeout: 180000,
          killSignal: "SIGKILL",
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      const log =
        (run.stdout ?? "") + (run.stderr ?? "") + (run.error?.message ?? "");
      if (
        run.error ||
        run.signal ||
        run.status === null ||
        run.status === 137 ||
        /sandbox_apply: Operation not permitted/.test(log)
      )
        throw new Error(
          `Acceptance preflight runner failed (${name}): ${log.slice(-6000)}`,
        );
      result.checks.push({ name, exitCode: run.status, log });
      return run.status;
    }
    // Tests are generated against existing public interfaces. A candidate that
    // does not compile cannot become an immutable acceptance contract.
    if (execute("typecheck", ["run", "typecheck"]) !== 0) {
      result.blockers.push(
        `Candidate acceptance code must typecheck before freezing. Fix test types/imports without suppressing diagnostics:\n${result.checks[0].log}`,
      );
      return result;
    }
    function runTests(scenario: string) {
      const reportPath = path.join(dir, "preflight-results.json");
      fs.rmSync(reportPath, { force: true });
      const exitCode = execute(scenario, [
        "exec",
        "vitest",
        "run",
        acceptancePath,
        "--maxWorkers=2",
        "--reporter=json",
        "--outputFile=preflight-results.json",
      ]);
      if (!fs.existsSync(reportPath))
        throw new Error(
          `Acceptance preflight produced no report (${scenario})`,
        );
      const raw = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      write(id, `acceptance-preflight-${attempt}-${scenario}.json`, raw);
      const summary = summarizeTestReport(raw, criteria);
      if (summary.missingCriteria.length)
        result.blockers.push(
          `Executable acceptance coverage missing: ${summary.missingCriteria.join(", ")}`,
        );
      if (!summary.failures.length && (!summary.passed || exitCode !== 0))
        throw new Error(
          `Acceptance preflight run failed outside assertions (${scenario}): ${summary.summary}`,
        );
      for (const failure of summary.failures)
        result.failures.push({
          ...failure,
          file: path.relative(dir, failure.file),
          id: `${scenario}-${result.failures.length + 1}`,
          scenario,
        });
    }
    runTests("baseline");
    const shippingPath = "src/components/ShippingProgress.tsx";
    if (fs.existsSync(path.join(dir, shippingPath))) {
      const probe = thresholdProbe(
        fs.readFileSync(path.join(dir, shippingPath), "utf8"),
        issue,
      );
      if (probe) {
        result.probe = { path: shippingPath, threshold: probe.threshold };
        fs.writeFileSync(path.join(dir, shippingPath), probe.source);
        runTests("requested-threshold-probe");
      }
    }
    return result;
  } finally {
    write(id, `acceptance-preflight-${attempt}.json`, result);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
