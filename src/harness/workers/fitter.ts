import {
  read,
  write,
  safePath,
  hash,
  type Diagnosis,
  type Draft,
} from "../common";
import { shippingRequest } from "../shipping-request";
import {
  ask,
  harnessMode,
  objectSchema,
  stringSchema,
  stringsSchema,
} from "../ai";
import { repositoryContext, validatePaths } from "../repository";
import {
  validateAcceptance,
  qualityHash,
  type AcceptanceTests,
} from "../quality";
import { format } from "prettier";
export const shippingPaths = [
  "src/components/CartDrawer.tsx",
  "src/components/ShippingProgress.tsx",
  "src/__tests__/shipping.test.tsx",
];
interface Plan {
  summary: string;
  files: { path: string; reason: string }[];
  risks: string[];
  verificationNotes: string[];
}
export async function fitter(
  id: string,
  explicitPaths: string[] | undefined,
  approvedCost: boolean,
) {
  const diagnosis = read<Diagnosis>(id, "diagnosis.json");
  if (
    !diagnosis.actionable ||
    !diagnosis.acceptanceCriteria?.length ||
    diagnosis.questions?.length
  )
    throw new Error("Issue requires clarification; see diagnosis.json");
  const mode = harnessMode();
  if (diagnosis.mode !== mode)
    throw new Error("Mode changed after triage; restart triage");
  const context = repositoryContext();
  let plan: Plan;
  if (mode === "openai") {
    if (!approvedCost) throw new Error("API execution requires cost approval");
    plan = await ask<Plan>(
      id,
      "fitter",
      "Create a senior-engineer implementation plan for every acceptance criterion. Select all necessary application, integration, style, data, regression test and documentation paths. Use the smallest complete scope, never a target file count. Preserve existing architecture and test assertions. Every path must be supported by a specific reason. Only application src (excluding harness and pipeline tests), docs Markdown and README.md are editable; no dependencies, CI or infrastructure. At least one implementation and one regression test path. Max 24 paths. Do not claim browser, security or performance verification was run; record manual verification still needed.",
      { diagnosis, repository: context, allowedPaths: explicitPaths },
      objectSchema({
        summary: stringSchema,
        files: {
          type: "array",
          items: objectSchema({ path: stringSchema, reason: stringSchema }),
        },
        risks: stringsSchema,
        verificationNotes: stringsSchema,
      }),
    );
  } else {
    if (!shippingRequest(diagnosis.issue))
      throw new Error("Unsupported offline issue");
    plan = {
      summary: diagnosis.reason,
      files: shippingPaths.map((path) => ({
        path,
        reason: path.includes("__tests__")
          ? "Regression coverage for shipping behavior"
          : path.includes("CartDrawer")
            ? "Verify shipping integrates with actual cart subtotal; keep unchanged if already correct"
            : "Implement requested shipping behavior",
      })),
      risks: diagnosis.risks ?? [],
      verificationNotes: [
        "Visual browser review remains a human responsibility",
      ],
    };
  }
  const paths = plan.files.map((f) => f.path);
  validatePaths(paths);
  if (
    explicitPaths &&
    (paths.length !== explicitPaths.length ||
      paths.some((p) => !explicitPaths.includes(p)))
  )
    throw new Error("Plan differs from explicit path scope");
  if (plan.files.some((f) => !f.reason.trim()) || !plan.summary.trim())
    throw new Error("Plan requires implementation rationale");
  const criteria = diagnosis.acceptanceCriteria.map((description, i) => ({
    id: `AC-${i + 1}`,
    description,
  }));
  if (criteria.length > 12 || criteria.some((c) => !c.description.trim()))
    throw new Error("Acceptance criteria must be bounded (1..12)");
  let acceptance: AcceptanceTests;
  if (mode === "openai") {
    acceptance = await ask<AcceptanceTests>(
      id,
      "acceptance_tests",
      "Act as an independent test engineer before implementation. Write executable Vitest / React Testing Library tests based on the requirements and existing public interfaces. Imports are relative to src/__tests__/issue-acceptance.test.tsx. Each acceptance criterion must have a top-level it or test whose literal name starts with its AC-N ID followed by a space. Test observable behavior, boundary and regression cases. Use real assertions and real implementation. Do not mock/spy on application code, skip tests, use placeholders or assert true equals true. Keep imports compatible with planned paths and existing repository APIs. Do not duplicate a new implementation inside tests.",
      { diagnosis, criteria, plan, repository: context },
      objectSchema({ code: stringSchema }),
    );
  } else {
    const threshold = shippingRequest(diagnosis.issue)!.threshold;
    acceptance = {
      code: `import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShippingProgress, FREE_SHIPPING_THRESHOLD, shippingProgress } from "../components/ShippingProgress";
import { CartDrawer } from "../components/CartDrawer";
import { products } from "../data/products";
it("AC-1 uses the issue threshold", () => { expect(FREE_SHIPPING_THRESHOLD).toBe(${threshold}); });
it("AC-2 handles empty, partial, boundary and qualified progress", () => {
  for (const [total, value] of [[-1, 0], [0, 0], [${threshold}/2, 50], [${threshold}, 100], [${threshold}+1, 100]]) expect(shippingProgress(total)).toBe(value);
  const view = render(<ShippingProgress subtotal={0}/>);
  expect(screen.getByRole("status")).toHaveTextContent("$${threshold.toFixed(2)} away");
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
  view.rerender(<ShippingProgress subtotal={${threshold}}/>);
  expect(screen.getByRole("status")).toHaveTextContent("You unlocked free shipping");
});
it("AC-3 responds to real cart quantity changes", () => {
  const item = {product: products[0], size: "M", color: products[0].colors[0], quantity: 1};
  const props = {onClose: () => {}, onQuantity: () => {}};
  const view = render(<CartDrawer items={[item]} {...props}/>);
  expect(Number(screen.getByRole("progressbar").getAttribute("value"))).toBeCloseTo(Math.min(100, products[0].price/${threshold}*100));
  view.rerender(<CartDrawer items={[{...item, quantity: 2}]} {...props}/>);
  expect(Number(screen.getByRole("progressbar").getAttribute("value"))).toBeCloseTo(Math.min(100, products[0].price*2/${threshold}*100));
});`,
    };
  }
  acceptance.code = await format(acceptance.code, { parser: "typescript" });
  validateAcceptance(acceptance, criteria);
  write(id, "acceptance-tests.json", acceptance);
  const draft: Draft = {
    qualityVersion: 2,
    mode,
    summary: plan.summary,
    rationale: Object.fromEntries(plan.files.map((f) => [f.path, f.reason])),
    acceptanceCriteria: criteria,
    risks: plan.risks,
    verificationNotes: plan.verificationNotes,
    paths,
    hashes: Object.fromEntries(paths.map((p) => [p, hash(safePath(p))])),
    contextHashes: context.hashes,
    acceptanceHash: qualityHash(id, "acceptance-tests.json"),
    constraints: [
      "Modify only planned paths",
      "Preserve unrelated behavior and existing regression assertions",
      "No dependencies, secrets, infrastructure or harness edits",
      "Meet every acceptance criterion; no placeholder implementation",
    ],
    tests: ["typecheck", "build", "test"],
    maxCycles: 3,
    approvedCost,
    issue: diagnosis.issue,
  };
  return write(id, "draft.json", draft);
}
