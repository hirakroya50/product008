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
export async function triager(id: string, approvedCost = false) {
  const issue = read<Issue>(id, "intake.json");
  const mode = harnessMode();
  if (mode === "openai") {
    if (!approvedCost) throw new Error("AI triage requires --approve-cost");
    write(id, "cost-approval.json", {
      approvedCost,
      approvedAt: new Date().toISOString(),
    });
    const diagnosis = await ask<Omit<Diagnosis, "issue" | "mode">>(
      id,
      "triager",
      "Analyze the actual repository against the complete issue. Identify affected subsystems, root cause or missing behavior, observable acceptance criteria, regression risks and ambiguities. Do not limit yourself to shipping. actionable must be false for ambiguous, unsupported, infrastructure/dependency changes or requirements not testable in this React/TypeScript repo. reproducible describes evidence in source, not a claim you ran tests. Return questions for missing requirements; do not invent requirements.",
      { issue, repository: repositoryContext() },
      objectSchema({
        severity: stringSchema,
        subsystems: stringsSchema,
        actionable: { type: "boolean" },
        reproducible: { type: "boolean" },
        reason: stringSchema,
        acceptanceCriteria: stringsSchema,
        risks: stringsSchema,
        questions: stringsSchema,
      }),
    );
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
  });
}
