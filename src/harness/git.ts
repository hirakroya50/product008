import fs from "node:fs";
import path from "node:path";
import { run, read, write, workDir, fingerprint, type Draft } from "./common";
import type { TestRecord } from "./workers/tester";
export function gate(id: string) {
  const d = read<Draft>(id, "draft.json");
  const t = read<TestRecord>(id, "test-record.json");
  if (t.status !== "passed" || t.fingerprint !== fingerprint())
    throw new Error("Fresh passing checks required before commit");
  const changed = run("git", ["status", "--porcelain", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3));
  if (changed.some((p) => !d.paths.includes(p)))
    throw new Error("Unexpected workspace edits block commit");
  if (changed.length) {
    const branch = `codex/issue-${d.issue.issueId}-${id.slice(-8)}`;
    run("git", ["switch", "-c", branch]);
    run("git", ["add", "--", ...d.paths]);
    run("git", [
      "-c",
      "user.name=Product 008 Agent",
      "-c",
      "user.email=product008@example.invalid",
      "commit",
      "-m",
      `fix(store): resolve issue #${d.issue.issueId} [automated]`,
    ]);
  }
  const sha = run("git", ["rev-parse", "HEAD"]);
  const branch = run("git", ["branch", "--show-current"]);
  const clean = run("git", ["status", "--porcelain"]) === "";
  const summary = `# ${d.issue.title.replace(/[\r\n]/g, " ")}

Issue #${d.issue.issueId}: ${d.issue.body}

## Changes
${d.paths.map((p) => "- " + p).join("\n")}

## Verification
${t.checks.map((c) => `- ${c.name}: ${c.status} (${c.durationMs} ms)`).join("\n")}

Runner: ${t.sandbox}
Commit: ${sha}
Branch: ${branch}

## Human approval gate
- [ ] Review implementation and issue scope
- [ ] Inspect sandbox logs and regression results
- [ ] Approve accessibility and cart behavior
- [ ] Authorize PR publication / merge

Status: awaiting-human-approval. No remote PR, push, merge, or deployment performed.
`;
  fs.writeFileSync(path.join(workDir(id), "pr-summary.md"), summary);
  return write(id, "git-record.json", {
    sha,
    branch,
    clean,
    status: "awaiting-human-approval",
    changedFiles: changed,
  });
}
