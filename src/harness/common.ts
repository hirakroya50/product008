import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
export const root = process.cwd();
export function run(command: string, args: string[], cwd = root) {
  const r = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.error || r.status !== 0)
    throw new Error(`${command}: ${r.error?.message ?? r.stderr ?? r.stdout}`);
  return r.stdout.trimEnd();
}
export function approve(args: string[], cost = false) {
  if (!args.includes("--approve-write"))
    throw new Error("Explicit --approve-write required");
  if (cost && !args.includes("--approve-cost"))
    throw new Error("Explicit --approve-cost required");
}
export function workDir(id: string) {
  if (!/^work-[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid work id");
  return path.join(root, "work", id);
}
export function read<T>(id: string, file: string): T {
  return JSON.parse(fs.readFileSync(path.join(workDir(id), file), "utf8"));
}
export function write<T>(id: string, file: string, data: T): T {
  fs.mkdirSync(workDir(id), { recursive: true });
  fs.writeFileSync(
    path.join(workDir(id), file),
    JSON.stringify(data, null, 2) + "\n",
  );
  return data;
}
export function safePath(p: string) {
  if (
    typeof p !== "string" ||
    !/^(?:src\/[a-zA-Z0-9_./-]+\.(?:tsx?|css|json)|docs\/[a-zA-Z0-9_./-]+\.md|README\.md)$/.test(
      p,
    ) ||
    p.split("/").some((part) => part === ".." || part === "." || !part) ||
    p.startsWith("src/harness/") ||
    /^src\/__tests__\/(?:setup|harness|shipping-request|valkey|pipeline-quality|issue-acceptance)\./.test(
      p,
    )
  )
    throw new Error(`Path outside patch scope: ${p}`);
  const absolute = path.resolve(root, p);
  let parent = absolute;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  if (
    fs.realpathSync(parent) !== root &&
    !fs.realpathSync(parent).startsWith(root + path.sep)
  )
    throw new Error("Symlink escape");
  return absolute;
}
export const hash = (p: string) =>
  fs.existsSync(p)
    ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")
    : null;
export interface Issue {
  title: string;
  body: string;
  labels: string[];
  issueId: string;
  workId: string;
}
export interface Diagnosis {
  severity: string;
  subsystems: string[];
  actionable: boolean;
  reason: string;
  reproducible: boolean;
  issue: Issue;
  mode?: "offline" | "openai";
  acceptanceCriteria?: string[];
  risks?: string[];
  questions?: string[];
  assumptions?: string[];
}
export interface Criterion {
  id: string;
  description: string;
}
export interface Draft {
  qualityVersion: 2;
  mode: "offline" | "openai";
  summary: string;
  rationale: Record<string, string>;
  acceptanceCriteria: Criterion[];
  risks: string[];
  verificationNotes: string[];
  assumptions?: string[];
  contextHashes: Record<string, string | null>;
  acceptanceHash: string;

  paths: string[];
  hashes: Record<string, string | null>;
  constraints: string[];
  tests: string[];
  maxCycles: number;
  approvedCost: boolean;
  issue: Issue;
}
export function fingerprint() {
  return crypto
    .createHash("sha256")
    .update(run("git", ["rev-parse", "HEAD"]))
    .update(run("git", ["diff", "HEAD"]))
    .update(
      run("git", ["ls-files", "--others", "--exclude-standard"])
        .split("\n")
        .filter(Boolean)
        .map((p) => p + hash(path.join(root, p)))
        .join(""),
    )
    .digest("hex");
}

export function getOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Missing value for ${name}`);
  return value;
}
