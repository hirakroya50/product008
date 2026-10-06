import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  root,
  read,
  write,
  fingerprint,
  hash,
  safePath,
  type Draft,
} from "../common";
import {
  acceptancePath,
  acceptanceReportPassed,
  validateAcceptance,
  qualityHash,
  type AcceptanceTests,
} from "../quality";
import { reviewer } from "./reviewer";
export interface TestRecord {
  status: string;
  cycle: number;
  durationMs: number;
  fingerprint: string;
  sandbox: string;
  draftHash: string;
  acceptanceHash: string;
  checks: {
    name: string;
    status: string;
    exitCode: number | null;
    durationMs: number;
    log: string;
  }[];
}
export async function tester(id: string, cycle = 0) {
  const draft = read<Draft>(id, "draft.json");
  const draftHash = qualityHash(id, "draft.json");
  const acceptanceHash = qualityHash(id, "acceptance-tests.json");
  if (draft.qualityVersion !== 2 || draft.acceptanceHash !== acceptanceHash)
    throw new Error("Acceptance contract changed; refit required");
  const acceptance = read<AcceptanceTests>(id, "acceptance-tests.json");
  validateAcceptance(acceptance, draft.acceptanceCriteria);
  if (!Number.isInteger(cycle) || cycle < 0 || cycle > 3)
    throw new Error("Cycle budget exceeded");
  if (process.platform !== "darwin" || !fs.existsSync("/usr/bin/sandbox-exec"))
    throw new Error(
      "Native sandbox unavailable. Stage A runner requires macOS sandbox-exec.",
    );
  const started = Date.now();
  const snapshot = fingerprint();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "product008-test-"));
  const physical = fs.realpathSync(dir);
  const checks: TestRecord["checks"] = [];
  try {
    for (const p of [
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
      fs.cpSync(path.join(root, p), path.join(dir, p), { recursive: true });
    // Keep dependency packages read-only, but put Vite caches in the sandbox.
    const modules = path.join(dir, "node_modules");
    fs.mkdirSync(modules);
    for (const entry of fs.readdirSync(path.join(root, "node_modules"))) {
      if ([".vite", ".vite-temp", ".cache"].includes(entry)) continue;
      fs.symlinkSync(
        path.join(root, "node_modules", entry),
        path.join(modules, entry),
      );
    }
    fs.writeFileSync(path.join(dir, acceptancePath), acceptance.code);
    const changed = draft.paths.filter(
      (p) => hash(safePath(p)) !== draft.hashes[p],
    );
    const profile = `(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath ${JSON.stringify(physical)}))(allow file-write* (literal "/dev/null"))`;
    const commands = [
      { name: "typecheck", args: ["run", "typecheck"] },
      { name: "build", args: ["run", "build"] },
      {
        name: "test",
        args: [
          "exec",
          "vitest",
          "run",
          "--reporter=json",
          "--outputFile=regression-results.json",
        ],
      },
      { name: "format", args: ["exec", "prettier", "--check", ...changed] },
      {
        name: "acceptance",
        args: [
          "exec",
          "vitest",
          "run",
          acceptancePath,
          "--reporter=json",
          "--outputFile=acceptance-results.json",
        ],
      },
    ];
    for (const { name, args } of commands) {
      const now = Date.now();
      if (name === "format" && changed.length === 0) {
        checks.push({
          name,
          status: "passed",
          exitCode: 0,
          durationMs: 0,
          log: "No changed files to format",
        });
        continue;
      }
      const result = spawnSync(
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
          },
          encoding: "utf8",
          timeout: 180000,
          killSignal: "SIGKILL",
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      let passed = result.status === 0 && !result.error;
      let detail = "";
      if (passed && (name === "acceptance" || name === "test")) {
        try {
          const report = JSON.parse(
            fs.readFileSync(
              path.join(
                dir,
                name === "acceptance"
                  ? "acceptance-results.json"
                  : "regression-results.json",
              ),
              "utf8",
            ),
          );
          passed = acceptanceReportPassed(report, draft.acceptanceCriteria);
          detail = `\nReported tests: ${report.numTotalTests}; passed: ${report.numPassedTests}; pending: ${report.numPendingTests}. Every criterion must run and pass; skipped tests fail the gate.`;
        } catch {
          passed = false;
          detail = "Missing or invalid machine-readable test report";
        }
      }
      checks.push({
        name,
        status: passed ? "passed" : "failed",
        exitCode: passed ? 0 : result.status === 0 ? 1 : result.status,
        durationMs: Date.now() - now,
        log:
          (result.stdout ?? "") +
          (result.stderr ?? "") +
          (result.error?.message ?? "") +
          detail,
      });
    }
    const diff = spawnSync("git", ["diff", "HEAD", "--check"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
    });
    checks.push({
      name: "diff-check",
      status: diff.status === 0 && !diff.error ? "passed" : "failed",
      exitCode: diff.status,
      durationMs: 0,
      log:
        (diff.stdout ?? "") + (diff.stderr ?? "") + (diff.error?.message ?? ""),
    });
    if (fingerprint() !== snapshot)
      throw new Error("Workspace changed during testing");
    let reviewLog = "Review deferred until executable checks pass";
    let reviewPassed = false;
    if (checks.every((c) => c.status === "passed")) {
      try {
        const review = await reviewer(id, checks, cycle);
        reviewPassed = review.status === "passed";
        reviewLog = JSON.stringify(review, null, 2);
      } catch (error) {
        reviewLog = `Review failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    checks.push({
      name: "review",
      status: reviewPassed ? "passed" : "failed",
      exitCode: reviewPassed ? 0 : 1,
      durationMs: 0,
      log: reviewLog,
    });
    if (
      fingerprint() !== snapshot ||
      qualityHash(id, "draft.json") !== draftHash ||
      qualityHash(id, "acceptance-tests.json") !== acceptanceHash
    )
      throw new Error("Workspace or quality contract changed during review");
    const record = write(id, "test-record.json", {
      status: checks.every((c) => c.status === "passed") ? "passed" : "failed",
      cycle,
      draftHash,
      acceptanceHash,
      durationMs: Date.now() - started,
      fingerprint: snapshot,
      sandbox:
        "macOS sandbox-exec; network denied; temporary-copy writes only; sanitized environment",
      checks,
    } satisfies TestRecord);
    write(id, `test-cycle-${cycle}.json`, record);
    return record;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
