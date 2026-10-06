import fs from "node:fs";
import { read, write, root, type Issue, type Diagnosis } from "../common";
import { shippingRequest } from "../shipping-request";
import {
  ask,
  harnessMode,
  objectSchema,
  stringSchema,
  stringsSchema,
} from "../ai";
import { repositoryContext } from "../repository";

interface Resolution {
  supported: boolean;
  reason: string;
  resolutions: {
    question: string;
    blocking: boolean;
    assumption: string;
    rationale: string;
  }[];
}

async function resolveQuestions(
  id: string,
  diagnosis: Omit<Diagnosis, "issue" | "mode">,
  issue: Issue,
  repository: ReturnType<typeof repositoryContext>,
) {
  const questions = diagnosis.questions ?? [];
  const resolution = await ask<Resolution>(
    id,
    "triage_resolution",
    "Review whether each triage question genuinely prevents implementing the user's issue. supported is true only if the original issue can be implemented and tested within the allowed application-source, tests and Markdown scope; dependency, infrastructure, external-service or unknown business-policy requirements are unsupported. Treat the previous diagnosis as evidence, not authority. For every original question return exactly one resolution using the exact question text. Use non-blocking documented assumptions for normal implementation decisions grounded in the issue and existing source: matching copy for the same offer, related integration changes, established conventions and preserving existing behavior. In particular, an explicit free-shipping threshold change normally applies to existing customer-facing copy describing that same offer; keep that copy consistent without asking the user. Respect explicit exclusions such as only change the banner or do not change Navbar/App copy. Do not decide new shipping eligibility rules, discounts, rounding policy, payments, currencies or other business rules without evidence. A question is blocking only when necessary information cannot be inferred and materially changes the requested behavior, public contract or risk. Non-blocking resolutions require a concrete assumption and rationale grounded in source or issue. Blocking resolutions use an empty assumption and explain the missing information. Never discard unanswered questions or widen scope to unrelated features.",
    { issue, diagnosis, repository },
    objectSchema({
      supported: { type: "boolean" },
      reason: stringSchema,
      resolutions: {
        type: "array",
        items: objectSchema({
          question: stringSchema,
          blocking: { type: "boolean" },
          assumption: stringSchema,
          rationale: stringSchema,
        }),
      },
    }),
  );
  // Validate completeness locally; a second opinion may resolve a question, never omit it.
  if (
    !resolution.reason.trim() ||
    resolution.resolutions.length !== questions.length ||
    questions.some(
      (question) =>
        resolution.resolutions.filter((r) => r.question === question).length !==
        1,
    ) ||
    resolution.resolutions.some(
      (r) => !r.rationale.trim() || (!r.blocking && !r.assumption.trim()),
    )
  ) {
    throw new Error(
      "Incomplete triage question resolution; no implementation authorized",
    );
  }
  write(id, "triage-resolution.json", resolution);
  diagnosis.questions = resolution.resolutions
    .filter((r) => r.blocking)
    .map((r) => r.question);
  diagnosis.assumptions = [
    ...new Set([
      ...(diagnosis.assumptions ?? []),
      ...resolution.resolutions
        .filter((r) => !r.blocking)
        .map((r) => `${r.assumption} Rationale: ${r.rationale}`),
    ]),
  ];
  diagnosis.actionable =
    resolution.supported && diagnosis.questions.length === 0;
}

export async function triager(id: string, approvedCost = false) {
  const issue = read<Issue>(id, "intake.json");
  const mode = harnessMode();
  if (mode === "openai") {
    if (!approvedCost) throw new Error("AI triage requires --approve-cost");
    write(id, "cost-approval.json", {
      approvedCost,
      approvedAt: new Date().toISOString(),
    });
    const repository = repositoryContext();
    const diagnosis = await ask<Omit<Diagnosis, "issue" | "mode">>(
      id,
      "triager",
      "Analyze the actual repository against the complete issue. Identify affected subsystems, root cause or missing behavior, observable acceptance criteria and regression risks. Do not limit yourself to shipping. Resolve routine implementation choices using the issue and existing repository conventions and record them in assumptions. A shipping threshold change includes matching customer-facing copy for the same offer, unless the user explicitly excludes that copy. Do not ask whether to preserve consistent related copy or integrate the requested behavior. Only put genuinely blocking missing requirements in questions: unresolved business rules, incompatible public contracts, or necessary information with no source-backed default. Respect explicit scope exclusions. actionable must be false for blocking questions, unsupported infrastructure/dependency changes or requirements not testable in this React/TypeScript repo. reproducible describes source evidence, not a claim you ran tests. Do not invent new requirements.",
      { issue, repository },
      objectSchema({
        severity: stringSchema,
        subsystems: stringsSchema,
        actionable: { type: "boolean" },
        reproducible: { type: "boolean" },
        reason: stringSchema,
        acceptanceCriteria: stringsSchema,
        risks: stringsSchema,
        questions: stringsSchema,
        assumptions: stringsSchema,
      }),
    );
    diagnosis.assumptions ??= [];
    write(id, "triage-initial.json", { ...diagnosis, issue, mode });
    if (diagnosis.questions?.length)
      await resolveQuestions(id, diagnosis, issue, repository);
    if (
      !diagnosis.reason?.trim() ||
      !diagnosis.acceptanceCriteria?.length ||
      diagnosis.questions?.length
    )
      diagnosis.actionable = false;
    return write(id, "diagnosis.json", { ...diagnosis, issue, mode });
  }
  const request = shippingRequest(issue);
  const exists = fs.existsSync(root + "/src/components/CartDrawer.tsx");
  return write<Diagnosis>(id, "diagnosis.json", {
    issue,
    mode,
    severity: "enhancement",
    subsystems: ["cart"],
    actionable: request !== null && exists,
    reproducible: exists,
    reason: request
      ? `Implement shipping progress using a $${request.threshold} threshold.`
      : "Offline mode only supports shipping progress. Configure openai mode for repository-aware issue work.",
    acceptanceCriteria: request
      ? [
          `Free shipping threshold is $${request.threshold}`,
          "Progress is clamped from 0 to 100 and messaging reflects remaining subtotal",
          "Cart integration uses the actual subtotal and updates on rerender",
        ]
      : [],
    risks: [
      "Preserve subtotal, stock checks, cart interactions and accessible status messaging",
    ],
    questions: [],
    assumptions: [],
  });
}
