import { spawnSync } from "node:child_process";

const [base, head] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(base ?? "") || !/^[a-f0-9]{40}$/.test(head ?? "")) {
  throw new Error("Expected base and head commit SHAs");
}
const diff = spawnSync(
  "git",
  ["diff", "--name-only", "--diff-filter=ACMR", "-z", base, head],
  { encoding: "utf8" },
);
if (diff.error || diff.status !== 0)
  throw new Error("Cannot inspect changed files");
const paths = diff.stdout
  .split("\0")
  .filter((p) => /\.(?:tsx?|mjs|css|json|md|ya?ml)$/.test(p));
if (paths.length) {
  const check = spawnSync(
    "pnpm",
    ["exec", "prettier", "--check", "--", ...paths],
    { stdio: "inherit" },
  );
  if (check.error) throw check.error;
  process.exitCode = check.status ?? 1;
} else {
  console.log("No supported changed files need formatting checks.");
}
