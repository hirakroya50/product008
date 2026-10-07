import { type Draft, hash, workDir } from "./common";
import path from "node:path";
import { parsers } from "prettier/plugins/typescript";

export interface AcceptanceTests {
  code: string;
  manualVerification?: { criterionId: string; steps: string[] }[];
}
export const acceptancePath = "src/__tests__/issue-acceptance.test.tsx";
export function validateAcceptance(
  tests: AcceptanceTests,
  criteria: Draft["acceptanceCriteria"],
) {
  if (tests.manualVerification !== undefined) {
    if (
      !Array.isArray(tests.manualVerification) ||
      tests.manualVerification.length > criteria.length ||
      new Set(tests.manualVerification.map((check) => check.criterionId))
        .size !== tests.manualVerification.length ||
      tests.manualVerification.some(
        (check) =>
          !criteria.some((criterion) => criterion.id === check.criterionId) ||
          !Array.isArray(check.steps) ||
          !check.steps.length ||
          check.steps.some((step) => typeof step !== "string" || !step.trim()),
      )
    )
      throw new Error(
        "Manual verification requires unique known criterion IDs and concrete pending steps",
      );
  }
  if (
    typeof tests.code !== "string" ||
    tests.code.length > 100000 ||
    !tests.code.includes("expect(")
  )
    throw new Error("Acceptance tests require real assertions");
  if (
    /\b(?:it|test|describe)\s*\.\s*(?:skip|todo|only)|\b(?:skipIf|runIf)\s*\(|@(?:ts-ignore|ts-nocheck)|\bprocess\s*\.\s*exit|\bvi\s*\.\s*(?:mock|spyOn)/.test(
      tests.code,
    )
  )
    throw new Error(
      "Acceptance tests cannot skip, mock implementation or suppress checks",
    );
  interface AstNode {
    type?: string;
    name?: string;
    callee?: AstNode;
    property?: AstNode;
    arguments?: AstNode[];
    body?: AstNode;
    [key: string]: unknown;
  }
  // Use the installed formatter's parser: TypeScript 7 no longer exports the compiler AST API.
  const parse = parsers.typescript.parse as (
    text: string,
    options: unknown,
  ) => AstNode;
  const source = parse(tests.code, {});
  function children(node: AstNode, visit: (node: AstNode) => void) {
    for (const [key, value] of Object.entries(node)) {
      if (["comments", "tokens", "loc", "range"].includes(key)) continue;
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === "object" && "type" in child)
            visit(child);
        }
      } else if (value && typeof value === "object" && "type" in value)
        visit(value as AstNode);
    }
  }
  function callName(node: AstNode) {
    return node.callee?.name ?? node.callee?.property?.name;
  }
  const importsCss = /import\s+(?:[\s\S]*?from\s+)?["'][^"']+\.css["']/.test(
    tests.code,
  );
  function inspectTest(node: AstNode) {
    if (
      importsCss &&
      ((node.type === "CallExpression" &&
        callName(node) === "getComputedStyle") ||
        (node.type === "MemberExpression" &&
          node.property?.name === "styleSheets"))
    )
      throw new Error(
        "Imported CSS is not loaded into jsdom by this Vitest configuration. Test tokens, selector declarations and media rules from CSS source (readFileSync), and retain pending browser checks for visual rendering; do not use getComputedStyle/document.styleSheets for imported CSS.",
      );
    if (
      node.type === "CallExpression" &&
      ["it", "test"].includes(callName(node) ?? "")
    ) {
      const callback = node.arguments?.find((argument) =>
        ["ArrowFunctionExpression", "FunctionExpression"].includes(
          argument.type ?? "",
        ),
      );
      if (callback?.body) {
        let renders = 0;
        let releases = 0;
        function count(child: AstNode) {
          if (child.type === "CallExpression") {
            if (callName(child) === "render") renders++;
            if (["unmount", "cleanup"].includes(callName(child) ?? ""))
              releases++;
          }
          children(child, count);
        }
        count(callback.body);
        if (renders > 1 && releases < renders - 1)
          throw new Error(
            "Acceptance test mounts multiple roots without cleanup/unmount. Use one render with rerender for changing states, or explicitly unmount between roots; afterEach cleanup does not run inside a test.",
          );
      }
    }
    children(node, inspectTest);
  }
  inspectTest(source);
  for (const criterion of criteria) {
    const escaped = criterion.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (
      !new RegExp(`(?:it|test)\\s*\\(\\s*["'\x60]${escaped}(?:\\s|:)`).test(
        tests.code,
      )
    )
      throw new Error(`Missing test for ${criterion.id}`);
  }
}
export function acceptanceReportPassed(
  report: unknown,
  criteria: Draft["acceptanceCriteria"],
) {
  const r = report as {
    testResults?: {
      assertionResults?: { fullName: string; status: string }[];
    }[];
  };
  const assertions =
    r.testResults?.flatMap((t) => t.assertionResults ?? []) ?? [];
  return (
    assertions.length > 0 &&
    assertions.every((a) => a.status === "passed") &&
    criteria.every((c) =>
      assertions.some((a) =>
        new RegExp(`\\b${c.id}(?:\\s|:)`).test(a.fullName),
      ),
    )
  );
}
export function qualityHash(id: string, file: string) {
  const value = hash(path.join(workDir(id), file));
  if (!value) throw new Error(`Missing quality artifact: ${file}`);
  return value;
}
export const requiredChecks = [
  "typecheck",
  "build",
  "test",
  "format",
  "diff-check",
  "acceptance",
  "review",
];
export function validateQualityChecks(
  checks: { name: string; status: string; exitCode: number | null }[],
) {
  if (
    checks.length !== requiredChecks.length ||
    requiredChecks.some(
      (name) =>
        checks.filter(
          (c) => c.name === name && c.status === "passed" && c.exitCode === 0,
        ).length !== 1,
    )
  )
    throw new Error("All required quality checks must pass");
}
