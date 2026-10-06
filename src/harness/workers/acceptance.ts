import { format } from "prettier";
import { ask, objectSchema, stringSchema, stringsSchema } from "../ai";
import { write, type Criterion, type Diagnosis } from "../common";
import { validateAcceptance, type AcceptanceTests } from "../quality";
import type { repositoryContext } from "../repository";
interface AcceptanceReview {
  valid: boolean;
  findings: string[];
  criteria: { id: string; status: string; evidence: string }[];
}
export async function prepareAcceptance(
  id: string,
  diagnosis: Diagnosis,
  criteria: Criterion[],
  plan: unknown,
  repository: ReturnType<typeof repositoryContext>,
) {
  let previousTests: AcceptanceTests | undefined;
  let findings: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const tests = await ask<AcceptanceTests>(
      id,
      "acceptance_tests",
      "Act as an independent test engineer before product implementation. Write executable Vitest / React Testing Library tests based on the issue and existing public APIs. Each criterion must have a top-level it/test with a literal name starting with its AC-N ID followed by a space. Imports are relative to src/__tests__/issue-acceptance.test.tsx. Use real assertions, real implementation, valid repository fixtures, observable behavior, meaningful boundaries and regressions. Exercise stock/quantity/subtotal APIs when those behaviors are required; merely checking static product fixture fields is insufficient. Use ONE render per test and rerender for changing props; explicitly unmount before mounting a different root. afterEach cleanup only runs between tests, so several render() calls in one test cause duplicate roles/text. Do not mock/spy on application code, skip checks, assert placeholders, duplicate implementation inside tests or invent APIs/fixtures. Address validation findings by fixing the test's harness or strengthening coverage, never by weakening expected business behavior. Preserve all acceptance criteria.",
      {
        diagnosis,
        criteria,
        plan,
        repository,
        previousTests,
        validationFindings: findings,
      },
      objectSchema({ code: stringSchema }),
    );
    previousTests = tests;
    try {
      tests.code = await format(tests.code, { parser: "typescript" });
      validateAcceptance(tests, criteria);
    } catch (error) {
      findings = [error instanceof Error ? error.message : String(error)];
      write(id, `acceptance-generation-${attempt}.json`, {
        tests,
        findings,
        status: "invalid",
      });
      continue;
    }
    const plannedPaths = new Set(
      ((plan as { files?: { path: string }[] }).files ?? []).map(
        (file) => file.path,
      ),
    );
    const unchangedReferenceSources = Object.fromEntries(
      Object.entries(repository.sources).filter(
        ([path]) => path.startsWith("src/") && !plannedPaths.has(path),
      ),
    );
    const review = await ask<AcceptanceReview>(
      id,
      "acceptance_review",
      "Independently review ONLY the CANDIDATE ACCEPTANCE TEST CODE before product development. All application source and existing regression tests supplied below are the UNCHANGED PRE-ISSUE BASELINE. The feature is deliberately not implemented yet. Compare every criterion against issue, source, public interfaces and fixtures. Check React Testing Library DOM isolation, duplicate-role queries, proper rerender/unmount, valid fixtures and imports, boundary expectations and regression coverage. Static fixture checks do not prove cart stock/quantity enforcement; require behavioral API/UI assertions. Do not demand implementing new business rules. Coverage means the candidate contains valid behavioral assertions for the requested future behavior. It does NOT mean that the current product already passes them. For example, expect(FREE_SHIPPING_THRESHOLD).toBe(250) is valid covered threshold testing even while the baseline constant is 75. Findings such as the constant remains 75, App copy still says $75, or existing regression tests assert $75 are expected baseline failures, NEVER candidate-test defects. Do not report those findings or mark criteria missing because of them. Judge criterion coverage solely from candidate assertions; use baseline source only to check public APIs, fixture validity and established behavior. Reject test-harness defects and omitted or trivial coverage. findings contains only blocking defects needing correction. Each criterion must appear exactly once with status covered or missing and concrete assertion evidence. Do not claim you ran tests.",
      {
        diagnosis,
        criteria,
        plan,
        unchangedReferenceSources,
        candidateAcceptanceTests: tests,
      },
      objectSchema({
        valid: { type: "boolean" },
        findings: stringsSchema,
        criteria: {
          type: "array",
          items: objectSchema({
            id: stringSchema,
            status: { type: "string", enum: ["covered", "missing"] },
            evidence: stringSchema,
          }),
        },
      }),
    );
    const covered =
      review.criteria.length === criteria.length &&
      criteria.every(
        (c) =>
          review.criteria.filter(
            (r) => r.id === c.id && r.status === "covered" && r.evidence.trim(),
          ).length === 1,
      );
    findings = review.findings;
    if (!covered)
      findings = [
        ...findings,
        "Every acceptance criterion requires meaningful assertion coverage",
      ];
    if (!review.valid && !findings.length)
      findings = ["Independent review rejected test validity"];
    write(id, `acceptance-generation-${attempt}.json`, {
      tests,
      review,
      findings,
      status:
        review.valid && covered && !findings.length ? "approved" : "invalid",
    });
    if (review.valid && covered && !findings.length) return tests;
  }
  throw new Error(
    `Acceptance test generation failed validation after 3 attempts: ${findings.join("; ")}. See work/${id}/acceptance-generation-*.json`,
  );
}
