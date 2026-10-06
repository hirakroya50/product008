import fs from "node:fs";
import { run, safePath, hash } from "./common";

export function repositoryContext() {
  const inventory = run("git", ["ls-files", "--", "src", "docs", "README.md"])
    .split("\n")
    .filter(Boolean)
    .filter((p) => {
      try {
        safePath(p);
        return true;
      } catch {
        return false;
      }
    });
  const sources: Record<string, string> = {};
  let size = 0;
  for (const p of inventory) {
    const source = fs.readFileSync(safePath(p), "utf8");
    size += source.length;
    if (source.length > 100000 || size > 250000)
      throw new Error(
        "Repository context budget exceeded; narrow scope before retrying",
      );
    sources[p] = source;
  }
  return {
    inventory,
    sources,
    hashes: Object.fromEntries(inventory.map((p) => [p, hash(safePath(p))])),
  };
}
export function validatePaths(paths: string[]) {
  if (
    !Array.isArray(paths) ||
    paths.length < 1 ||
    paths.length > 24 ||
    new Set(paths).size !== paths.length
  )
    throw new Error("Plan requires 1..24 unique paths");
  for (const p of paths) safePath(p);
  if (!paths.some((p) => /^src\/(?!__tests__\/)/.test(p)))
    throw new Error("Plan requires application implementation");
  if (!paths.some((p) => /^src\/__tests__\/.*\.test\.tsx?$/.test(p)))
    throw new Error("Plan requires regression tests");
}
export function sourcesFor(paths: string[]) {
  return Object.fromEntries(
    paths.map((p) => [
      p,
      fs.existsSync(safePath(p)) ? fs.readFileSync(safePath(p), "utf8") : "",
    ]),
  );
}
