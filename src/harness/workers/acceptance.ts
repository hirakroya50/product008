import { format } from "prettier";
import fs from "node:fs";
import path from "node:path";
import { ask, objectSchema, stringSchema, stringsSchema } from "../ai";
import { write, workDir, type Criterion, type Diagnosis } from "../common";
import { validateAcceptance, type AcceptanceTests } from "../quality";
import type { repositoryContext } from "../repository";
interface AcceptanceReview {
  valid: boolean;
  findings: string[];
  criteria: { id: string; status: string; evidence: string }[];
}
const queryGuidance =
  "Check query uniqueness against the DOM at EACH asserted state, including after quantity updates and checkout. One render can still contain duplicate text or roles. For repeated prices, scope with within() to the intended item or subtotal container, or use getAllByText and assert the expected count and values. For multiple status elements, select the intended message by its unique text and assert its role, or scope within a container that contains only that status. Scoping to a dialog alone is insufficient if both statuses are inside the dialog. Do not invent accessible names absent from source. In this baseline, <p role='status'> text does NOT give the element an accessible name: getByRole('status', {name: message}) fails for both shipping and checkout. Use within(getByRole('region', {name: 'Free shipping progress'})).getByRole('status') for shipping, or getByText(message) plus toHaveAttribute('role', 'status') for checkout. Existing regression tests provide examples of safe queries; preserve their behavior. Never replace an ambiguous query with an arbitrary [0] or weaken its assertion.";
const coverageGuidance =
  "For styling criteria listing multiple surfaces, enumerate every named surface from source and assert token usage for each relevant selector; checking only one cart button does not cover close buttons, quantity buttons, size controls, inputs, cards or dialogs. For category text such as Graphic Tees appearing in both filters and product tags, use getByRole('button', {name: 'Graphic Tees'}) for the filter. For a tag, scope within a specific product card, or assert all matching tags using their actual selector and expected values. Never use screen.getByText('Graphic Tees') when rendering the full catalog.";
const cartGuidance =
  "For cart regressions, trace every add/increase/decrease/remove action against the actual cart APIs before choosing assertions. Stock is shared across ALL size/color variants of a product, not a separate allowance for each line. Line total = that line's quantity * price; subtotal = the sum of ALL remaining line totals. Recompute quantities, totals and DOM query counts after every action, including blocked increases and removals. For the existing Out of Office fixture ($32, stock 12), two variants starting at quantity 1 each allow the first to reach only 11 while the second stays at 1: line totals $352 and $32, subtotal $384. Another increase is blocked. Decreasing the first then gives quantities 10 and 1: line totals $320 and $32, subtotal $352. Scope price assertions within the specific .cart-item and .subtotal separately; a dialog can contain both. Prefer separate focused stock and subtotal tests over a long UI sequence if it makes the state clearer. For criteria preserving existing behavior, use the existing regression tests as the behavioral reference; do not invent new business rules.";
const shippingGuidance =
  'For ShippingProgress boundaries, determine the intended threshold from the acceptance criteria (use the baseline threshold when preserving behavior). Remaining dollars = max(0, threshold - subtotal). At subtotal 0, including after removing the FINAL cart item, a positive threshold means the full threshold remains and progress is 0%; it NEVER means free shipping is unlocked. For the unchanged $75 offer, assert "You\'re $75.00 away from free shipping." at $0.00, and "You unlocked free shipping!" with 100% progress at exactly $75.00 and above. If the issue changes the threshold, use that requested value instead of hardcoding $75. Removing items must recompute the shipping message; unlocked status is not sticky. Cover empty, below-threshold, exact-threshold and above-threshold states separately, using rerender for component boundaries and actual cart actions for removal regressions. On repair, correct only the invalid state expectation and retain the valid exact-threshold unlocked assertion (add a separate exact-threshold test if missing); never globally replace the unlocked message or delete boundary coverage.';
const manualGuidance =
  "This repository uses Vitest/jsdom, which cannot verify rendered layout, clipping, focus-ring visibility or real viewport breakpoints. For a criterion mixing automated and visual/manual verification, test its automatable requirements and include concrete pending browser steps in manualVerification with the same criterionId. Include viewports, surfaces, actions and expected visual results; these steps will be retained in the draft PR for human review. Do not claim these checks ran. Every criterion still needs meaningful executable assertions for its automatable portion; a checklist does not replace those assertions. During pre-implementation test review, assess the assertions and completeness of the pending checklist, not results of browser checks that cannot have run yet. Reject missing checklists or checklists used to avoid automatable requirements. Do not demand browser tooling or dependencies absent from the repository.";

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
      "Act as an independent test engineer before product implementation. Write executable Vitest / React Testing Library tests based on the issue and existing public APIs. Each criterion must have a top-level it/test with a literal name starting with its AC-N ID followed by a space. Imports are relative to src/__tests__/issue-acceptance.test.tsx. Use real assertions, real implementation, valid repository fixtures, observable behavior, meaningful boundaries and regressions. Exercise stock/quantity/subtotal APIs when those behaviors are required; merely checking static product fixture fields is insufficient. Use ONE render per test and rerender for changing props; explicitly unmount before mounting a different root. afterEach cleanup only runs between tests, so several render() calls in one test cause duplicate roles/text. Do not mock/spy on application code, skip checks, assert placeholders, duplicate implementation inside tests or invent APIs/fixtures. Address validation findings by fixing the test's harness or strengthening coverage, never by weakening expected business behavior. Preserve all acceptance criteria. " +
        queryGuidance +
        " " +
        coverageGuidance +
        " " +
        cartGuidance +
        " " +
        shippingGuidance +
        " " +
        manualGuidance +
        (previousTests
          ? " This is a REPAIR of previousTests, not a fresh test design. Correct every validationFinding in the existing candidate, inspect all similar queries for the same defect, and retain unaffected tests and assertions. When correcting a cart action or quantity expectation, recompute EVERY downstream line total, subtotal and query count from the corrected sequence; do not mechanically change just the reported assertion. Return the complete corrected code."
          : ""),
      {
        diagnosis,
        criteria,
        plan,
        repository,
        previousTests,
        validationFindings: findings,
      },
      objectSchema({
        code: stringSchema,
        manualVerification: {
          type: "array",
          items: objectSchema({
            criterionId: stringSchema,
            steps: stringsSchema,
          }),
        },
      }),
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
    const review = await ask<AcceptanceReview>(
      id,
      "acceptance_review",
      "Independently review ONLY the CANDIDATE ACCEPTANCE TEST CODE before product development. All application source and existing regression tests supplied below are the UNCHANGED PRE-ISSUE BASELINE. The feature is deliberately not implemented yet. Compare every criterion against issue, source, public interfaces and fixtures. Check React Testing Library DOM isolation, duplicate-role queries, proper rerender/unmount, valid fixtures and imports, boundary expectations and regression coverage. Static fixture checks do not prove cart stock/quantity enforcement; require behavioral API/UI assertions. Do not demand implementing new business rules. Coverage means the candidate contains valid behavioral assertions for the requested future behavior. It does NOT mean that the current product already passes them. For example, expect(FREE_SHIPPING_THRESHOLD).toBe(250) is valid covered threshold testing even while the baseline constant is 75. Findings such as the constant remains 75, App copy still says $75, or existing regression tests assert $75 are expected baseline failures, NEVER candidate-test defects. Do not report those findings or mark criteria missing because of them. Judge automated coverage solely from candidate assertions; use baseline source only to check public APIs, fixture validity and established behavior. Reject test-harness defects and omitted or trivial coverage. findings contains only blocking defects needing correction. Each criterion must appear exactly once with status covered or missing and concrete assertion evidence. Verify that evidence actually exists in candidateAcceptanceTests.code: do not claim an exact-threshold assertion exists merely because baseline regression tests contain one. Do not claim you ran tests. " +
        queryGuidance +
        " " +
        cartGuidance +
        " " +
        shippingGuidance +
        " " +
        manualGuidance,
      {
        diagnosis,
        criteria,
        plan,
        // Planned files are still baseline source here; reviewers need them to
        // check existing DOM structure and APIs before implementation starts.
        baselineSources: repository.sources,
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
  const message = `Acceptance test generation failed validation after 3 attempts: ${findings.join("; ")}. See work/${id}/acceptance-generation-*.json`;
  fs.writeFileSync(
    path.join(workDir(id), "investigation.md"),
    `## Acceptance test generation stopped\n\nWork record: \`${id}\`. Product implementation has not started.\n\n${message}\n\nDownload this run's Actions artifact and inspect \`work/${id}/acceptance-generation-0.json\` through \`acceptance-generation-2.json\` for candidate tests and validation findings. Correct test generation without weakening the acceptance criteria, push the correction to the default branch, then run the issue workflow again with the same issue number.\n`,
  );
  throw new Error(message);
}
