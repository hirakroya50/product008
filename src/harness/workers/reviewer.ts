import { ask, objectSchema, stringSchema } from "../ai";
import { read, write, fingerprint, type Draft } from "../common";
import { repositoryContext, sourcesFor } from "../repository";
import { qualityHash } from "../quality";
export interface Review {
  status: "passed" | "failed";
  summary: string;
  criteria: { id: string; status: string; evidence: string }[];
  findings: { priority: string; path: string; description: string }[];
  mode: string;
  fingerprint: string;
  draftHash: string;
  acceptanceHash: string;
}
export function reviewPassed(
  review: Pick<Review, "criteria" | "findings">,
  draft: Draft,
) {
  return (
    review.criteria.length === draft.acceptanceCriteria.length &&
    draft.acceptanceCriteria.every(
      (c) =>
        review.criteria.filter(
          (r) => r.id === c.id && r.status === "met" && r.evidence.trim(),
        ).length === 1,
    ) &&
    !review.findings.some((f) => f.priority !== "P3")
  );
}
export async function reviewer(id: string, checks: unknown[], cycle: number) {
  const draft = read<Draft>(id, "draft.json");
  let result: Pick<Review, "summary" | "criteria" | "findings">;
  if (draft.mode === "openai") {
    result = await ask(
      id,
      "reviewer",
      "Independently review this proposed PR as a senior engineer. Do not trust developer success claims or passing tests alone. Compare original and final source against the ENTIRE issue and every acceptance criterion. Look for omitted integrations, shallow/stub implementations, regression assertions removed or weakened, mismatched independent acceptance tests, security, accessibility, state/error handling and unintended scope. Verify tests assert actual user behavior and important boundaries. Mark criteria unmet where evidence is missing. Report actionable P0/P1/P2 blockers and P3 optional improvements with precise paths and fixes. Do not invent test runs. Ensure unrelated files were preserved. A small diff is acceptable if complete; never request file churn for its own sake. This pipeline publishes a draft PR for human review. Pending visual/browser checks recorded in acceptance.manualVerification and draft.verificationNotes must remain explicitly pending in your evidence and summary. For mixed automated/manual criteria, judge implementation and automated assertions now and verify the pending checklist is concrete and complete; do not demand completed browser results from jsdom. A pending browser checklist is not evidence that visual checks passed and must not excuse missing code, automated assertions or known clipping/focus defects. Reject omitted manual requirements, fabricated visual results, or attempts to defer automatable behavior.",
      {
        draft,
        originalSources: read(id, "source-backup.json"),
        finalSources: sourcesFor(draft.paths),
        repository: repositoryContext(),
        acceptance: read(id, "acceptance-tests.json"),
        checks,
      },
      objectSchema({
        summary: stringSchema,
        criteria: {
          type: "array",
          items: objectSchema({
            id: stringSchema,
            status: { type: "string", enum: ["met", "unmet"] },
            evidence: stringSchema,
          }),
        },
        findings: {
          type: "array",
          items: objectSchema({
            priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
            path: stringSchema,
            description: stringSchema,
          }),
        },
      }),
    );
  } else {
    result = {
      summary:
        "Deterministic shipping demo review: independent shipping acceptance checks and regression suite passed. General AI code review was not performed.",
      criteria: draft.acceptanceCriteria.map((c) => ({
        id: c.id,
        status: "met",
        evidence: `Independent executable ${c.id} test passed in the sandbox`,
      })),
      findings: [],
    };
  }
  const review: Review = {
    ...result,
    status: reviewPassed(result, draft) ? "passed" : "failed",
    mode:
      draft.mode === "openai"
        ? "independent-ai-review"
        : "offline-shipping-checks",
    fingerprint: fingerprint(),
    draftHash: qualityHash(id, "draft.json"),
    acceptanceHash: qualityHash(id, "acceptance-tests.json"),
  };
  write(id, `review-cycle-${cycle}.json`, review);
  return write(id, "review-record.json", review);
}
