import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { write, run, type Issue } from "./common";
export function normalize(payload: unknown): Issue {
  const p = payload as Record<string, unknown>;
  if (
    !p ||
    typeof p.title !== "string" ||
    !p.title.trim() ||
    p.title.length > 300 ||
    typeof p.body !== "string" ||
    p.body.length > 20000
  )
    throw new Error("Issue requires bounded title and body");
  const issueId = String(p.issueId ?? p.number ?? "local");
  if (!/^[a-zA-Z0-9-]+$/.test(issueId)) throw new Error("Invalid issueId");
  const labels = Array.isArray(p.labels)
    ? p.labels.map((l) =>
        typeof l === "string" ? l : String((l as { name: string }).name),
      )
    : [];
  return {
    title: p.title.trim(),
    body: p.body,
    labels,
    issueId,
    workId: `work-${issueId}-${randomUUID().slice(0, 8)}`,
  };
}
export function intake(file: string) {
  const issue = normalize(JSON.parse(fs.readFileSync(file, "utf8")));
  write(issue.workId, "intake.json", issue);
  return { workId: issue.workId, status: "accepted" };
}
export function intakeIssue(number: string) {
  if (!/^\d+$/.test(number)) throw new Error("Numeric GitHub issue required");
  const issue = normalize(
    JSON.parse(
      run("gh", [
        "issue",
        "view",
        number,
        "--json",
        "title,body,labels,number",
      ]),
    ),
  );
  write(issue.workId, "intake.json", issue);
  return { workId: issue.workId, status: "accepted" };
}
