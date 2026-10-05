import fs from "node:fs";
import path from "node:path";
import { read, root, run, write, workDir, hash } from "./common";
import { leaseProbe } from "./lease";
import type { Diagnosis, Draft } from "./common";
import type { TestRecord } from "./workers/tester";
const names = [
  "Workspace clean",
  "Typecheck passes",
  "Offline test pass",
  "Lease acquire/release",
  "Triager diagnosis valid",
  "Fitter plan bounded",
  "Developer patch applied",
  "Tester regression pass",
  "Clean git tree",
  "Commit SHA generated",
  "PR summary generated",
  "Concurrency lock",
  "Bounded execution cycle",
  "Stage A audit artifacts",
  "Stage A audit integrity",
];
export const deferredReason =
  "Stage B deferred; S3, Product 007 contract, and hostname unavailable.";
export interface Evidence {
  scope: string;
  workId: string;
  generatedAt: string;
  cases: {
    caseId: number;
    stage: string;
    name: string;
    status: string;
    artifact?: string;
    reason?: string;
    sha256?: string;
  }[];
}
export async function collect(id: string, file: string) {
  const diagnosis = read<Diagnosis>(id, "diagnosis.json");
  const draft = read<Draft>(id, "draft.json");
  const patch = read<{ applied: boolean; mode: string }>(
    id,
    "patch-record.json",
  );
  const tests = read<TestRecord>(id, "test-record.json");
  const git = read<{ sha: string; clean: boolean }>(id, "git-record.json");
  const audit = read<{ initialClean: boolean; collisionDenied: boolean }>(
    id,
    "audit.json",
  );
  const lease = await leaseProbe();
  write(id, "lease-record.json", lease);
  const clean = run("git", ["status", "--porcelain"]) === "";
  const passed = [
    audit.initialClean,
    tests.checks.find((c) => c.name === "typecheck")?.status === "passed",
    patch.mode === "offline" &&
      tests.checks.find((c) => c.name === "test")?.status === "passed",
    lease.status === "passed",
    diagnosis.actionable && diagnosis.reproducible,
    draft.paths.length === 3,
    patch.applied,
    tests.status === "passed",
    clean && git.clean,
    /^[0-9a-f]{40}$/.test(git.sha),
    fs.existsSync(path.join(workDir(id), "pr-summary.md")),
    audit.collisionDenied,
    tests.cycle <= 3,
    tests.checks.length === 3 && tests.sandbox.includes("network denied"),
    run("git", ["rev-parse", "HEAD"]) === git.sha,
  ];
  const artifacts = [
    "audit.json",
    "test-record.json",
    "test-record.json",
    "lease-record.json",
    "diagnosis.json",
    "draft.json",
    "patch-record.json",
    "test-record.json",
    "git-record.json",
    "git-record.json",
    "pr-summary.md",
    "audit.json",
    "test-record.json",
    "test-record.json",
    "git-record.json",
  ];
  const evidence: Evidence = {
    scope: "stage-A",
    workId: id,
    generatedAt: new Date().toISOString(),
    cases: [
      ...names.map((name, i) => {
        const artifact = `work/${id}/${artifacts[i]}`;
        return {
          caseId: i + 1,
          stage: "A",
          name,
          status: passed[i] ? "passed" : "failed",
          artifact,
          sha256: hash(path.join(root, artifact))!,
        };
      }),
      ...Array.from({ length: 7 }, (_, i) => ({
        caseId: i + 14,
        stage: "B",
        name: `Stage B case ${i + 14}`,
        status: "deferred",
        reason: deferredReason,
      })),
    ],
  };
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + "\n");
  return evidence;
}
export function acceptance(file: string) {
  const e: Evidence = JSON.parse(fs.readFileSync(file, "utf8"));
  const active = e.cases.filter((c) => c.stage === "A");
  const deferred = e.cases.filter((c) => c.stage === "B");
  if (
    e.scope !== "stage-A" ||
    active.length !== 15 ||
    new Set(active.map((c) => c.caseId)).size !== 15 ||
    active.some(
      (c) => c.caseId < 1 || c.caseId > 15 || c.status !== "passed",
    ) ||
    deferred.length !== 7 ||
    deferred.some(
      (c, i) =>
        c.caseId !== i + 14 ||
        c.status !== "deferred" ||
        c.reason !== deferredReason,
    )
  )
    throw new Error("Acceptance registry schema/status invalid");
  for (const c of active) {
    if (
      c.artifact !== `work/${e.workId}/${path.basename(c.artifact ?? "")}` ||
      !c.sha256 ||
      hash(path.join(root, c.artifact)) !== c.sha256
    )
      throw new Error(`Missing or changed audit artifact for case ${c.caseId}`);
  }
  const git = read<{ sha: string }>(e.workId, "git-record.json");
  if (
    run("git", ["rev-parse", "HEAD"]) !== git.sha ||
    run("git", ["status", "--porcelain"])
  )
    throw new Error("Evidence requires recorded commit and clean tree");
  return {
    scope: "stage-A",
    activePassed: 15,
    activeTotal: 15,
    deferredCases: deferred.map((c) => ({
      caseId: c.caseId,
      status: c.status,
      reason: c.reason,
    })),
  };
}
