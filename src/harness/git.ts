import fs from "node:fs";
import path from "node:path";
import { run, read, write, workDir, fingerprint, type Draft } from "./common";
import type { TestRecord } from "./workers/tester";
import { reviewPassed, type Review } from "./workers/reviewer";
import { qualityHash, validateQualityChecks } from "./quality";

export function assertReady(
  id: string,
  d: Draft,
  t: TestRecord,
  review: Review,
) {
  validateQualityChecks(t.checks);
  if (
    d.qualityVersion !== 2 ||
    t.status !== "passed" ||
    t.fingerprint !== fingerprint() ||
    t.draftHash !== qualityHash(id, "draft.json") ||
    t.acceptanceHash !== qualityHash(id, "acceptance-tests.json") ||
    d.acceptanceHash !== t.acceptanceHash ||
    review.status !== "passed" ||
    review.fingerprint !== t.fingerprint ||
    review.draftHash !== t.draftHash ||
    review.acceptanceHash !== t.acceptanceHash ||
    !reviewPassed(review, d)
  )
    throw new Error(
      "Fresh passing checks, immutable acceptance contract and independent review required before commit",
    );
}
interface GitRecord {
  sha: string;
  baseSha: string;
  branch: string;
  clean: boolean;
  status: string;
  changedFiles: string[];
  artifactHashes: Record<string, string>;
}
export function verifyPublication(id: string) {
  const record = read<GitRecord>(id, "git-record.json");
  if (
    !record.clean ||
    record.status !== "awaiting-human-approval" ||
    run("git", ["rev-parse", "HEAD"]) !== record.sha ||
    run("git", ["branch", "--show-current"]) !== record.branch ||
    run("git", ["status", "--porcelain"])
  )
    throw new Error(
      "Publication requires the reviewed commit and clean branch",
    );
  for (const [file, expected] of Object.entries(record.artifactHashes))
    if (qualityHash(id, file) !== expected)
      throw new Error(`Quality artifact changed before publication: ${file}`);
  if (Object.keys(record.artifactHashes).length !== 6)
    throw new Error("Incomplete publication evidence");
  return { status: "passed", sha: record.sha, branch: record.branch };
}
export function gate(id: string) {
  const d = read<Draft>(id, "draft.json");
  const t = read<TestRecord>(id, "test-record.json");
  const review = read<Review>(id, "review-record.json");
  assertReady(id, d, t, review);
  const changed = run("git", ["status", "--porcelain", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3));
  if (changed.some((p) => !d.paths.includes(p)))
    throw new Error("Unexpected workspace edits block commit");
  const baseSha = run("git", ["rev-parse", "HEAD"]);
  const title = `${d.issue.title.replace(/[\r\n]/g, " ").slice(0, 180)} (#${d.issue.issueId})`;
  if (changed.length) {
    const branch = `codex/issue-${d.issue.issueId}-${id.slice(-8)}`;
    run("git", ["switch", "-c", branch]);
    run("git", ["add", "--", ...changed]);
    run("git", [
      "-c",
      "user.name=Product 008 Agent",
      "-c",
      "user.email=product008@example.invalid",
      "commit",
      "-m",
      title,
    ]);
  }
  const sha = run("git", ["rev-parse", "HEAD"]);
  const branch = run("git", ["branch", "--show-current"]);
  const clean = run("git", ["status", "--porcelain"]) === "";
  if (!clean) throw new Error("Unexpected changes after commit");
  const unchanged = d.paths.filter((p) => !changed.includes(p));
  const summary = `## Summary
${d.summary}

Closes #${d.issue.issueId}
Mode: ${d.mode === "openai" ? "Repository-aware AI implementation and independent AI review" : "Deterministic offline shipping demo"}

## Changes
${changed.length ? changed.map((p) => `- \`${p}\`: ${d.rationale[p]}`).join("\n") : "Requested behavior is already present; no new changes."}
${unchanged.length ? `\nInspected and retained without changes: ${unchanged.map((p) => `\`${p}\``).join(", ")}.` : ""}

${d.assumptions?.length ? `## Implementation assumptions\n${d.assumptions.map((assumption) => `- ${assumption}`).join("\n")}\n\n` : ""}## Acceptance evidence
${review.criteria.map((c) => `- **${c.id}**: ${d.acceptanceCriteria.find((a) => a.id === c.id)?.description} — ${c.status}. ${c.evidence}`).join("\n")}

## Verification
${t.checks.map((c) => `- ${c.name}: ${c.status} (${c.durationMs} ms)`).join("\n")}

Review: ${review.summary}
${review.findings.length ? review.findings.map((f) => `- ${f.priority}: ${f.path}: ${f.description}`).join("\n") : "No blocking review findings."}

## Risks and manual verification
${[...d.risks, ...d.verificationNotes].map((r) => `- ${r}`).join("\n") || "- Review the diff and application behavior before merging."}
- AI review is fallible; maintainer review is required.

## Reproducibility
- Runner: ${t.sandbox}
- Commit: ${sha}
- Branch: ${branch}
- Work record: \`work/${id}/\` (download the workflow artifact for acceptance tests, per-cycle logs, review and API usage)

## Maintainer review
- [ ] Confirm the complete issue is resolved and review any remaining manual checks
- [ ] Review implementation, regression tests, acceptance evidence and logs
- [ ] Approve the draft PR for merge
`;
  fs.writeFileSync(path.join(workDir(id), "pr-summary.md"), summary);
  fs.writeFileSync(path.join(workDir(id), "pr-title.txt"), title + "\n");
  return write<GitRecord>(id, "git-record.json", {
    sha,
    baseSha,
    branch,
    clean,
    status: "awaiting-human-approval",
    changedFiles: changed,
    artifactHashes: Object.fromEntries(
      [
        "draft.json",
        "acceptance-tests.json",
        "test-record.json",
        "review-record.json",
        "pr-summary.md",
        "pr-title.txt",
      ].map((file) => [file, qualityHash(id, file)]),
    ),
  });
}
