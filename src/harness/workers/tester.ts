import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { root, read, write, fingerprint, type Draft } from "../common";
export interface TestRecord {
  status: string;
  cycle: number;
  durationMs: number;
  fingerprint: string;
  sandbox: string;
  checks: {
    name: string;
    status: string;
    exitCode: number | null;
    durationMs: number;
    log: string;
  }[];
}
export function tester(id: string, cycle = 0) {
  read<Draft>(id, "draft.json");
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
      "public",
      "index.html",
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig.json",
      "vite.config.ts",
    ])
      fs.cpSync(path.join(root, p), path.join(dir, p), { recursive: true });
    fs.symlinkSync(
      path.join(root, "node_modules"),
      path.join(dir, "node_modules"),
      "dir",
    );
    const profile = `(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath ${JSON.stringify(physical)}))(allow file-write* (literal "/dev/null"))`;
    for (const name of ["typecheck", "build", "test"]) {
      const now = Date.now();
      const result = spawnSync(
        "/usr/bin/sandbox-exec",
        ["-p", profile, "pnpm", "run", name],
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
      checks.push({
        name,
        status: result.status === 0 ? "passed" : "failed",
        exitCode: result.status,
        durationMs: Date.now() - now,
        log:
          (result.stdout ?? "") +
          (result.stderr ?? "") +
          (result.error?.message ?? ""),
      });
    }
    return write(id, "test-record.json", {
      status: checks.every((c) => c.status === "passed") ? "passed" : "failed",
      cycle,
      durationMs: Date.now() - started,
      fingerprint: snapshot,
      sandbox:
        "macOS sandbox-exec; network denied; temporary-copy writes only; sanitized environment",
      checks,
    } satisfies TestRecord);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
