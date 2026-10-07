// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptanceReportPassed,
  validateAcceptance,
  validateQualityChecks,
  requiredChecks,
  qualityHash,
} from "../harness/quality";
import {
  safePath,
  write,
  read,
  workDir,
  type Draft,
  type Issue,
} from "../harness/common";
import * as repository from "../harness/repository";
import { validatePaths } from "../harness/repository";
import { reviewPassed, reviewer } from "../harness/workers/reviewer";
import { triager } from "../harness/workers/triager";
import { prepareAcceptance } from "../harness/workers/acceptance";
import { fitter } from "../harness/workers/fitter";
import { developer } from "../harness/workers/developer";
import * as developerWorker from "../harness/workers/developer";
import * as testerWorker from "../harness/workers/tester";
import { fixer } from "../harness/workers/fixer";
import { ask, objectSchema, stringSchema } from "../harness/ai";
import * as common from "../harness/common";
import type { TestRecord } from "../harness/workers/tester";
import type { Review } from "../harness/workers/reviewer";
import { assertReady, verifyPublication } from "../harness/git";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    responses = { create };
  },
}));
vi.mock("../harness/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../harness/repository")>();
  return {
    ...actual,
    repositoryContext: () => ({
      inventory: ["src/cart.ts"],
      sources: {
        "src/cart.ts":
          "export function subtotal(items: {price: number}[]) { return items.reduce((total, item) => total + item.price, 0); }",
      },
      hashes: {},
    }),
  };
});
const criteria = [
  { id: "AC-1", description: "Calculates the actual cart subtotal" },
];
const workIds: string[] = [];
function fixture() {
  const id = `work-quality-${randomUUID()}`;
  workIds.push(id);
  write(id, "intake.json", {
    title: "Correct cart subtotal rounding",
    body: "Round the final cart subtotal to cents without changing stock checks.",
    labels: [],
    issueId: "1",
    workId: id,
  });
  return id;
}
function aiMode() {
  vi.stubEnv("HARNESS_MODE", "openai");
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_MODEL", "test-model");
}
function reply(value: unknown) {
  return {
    id: "test-response",
    status: "completed",
    output_text: JSON.stringify(value),
    usage: { total_tokens: 10 },
  };
}
const shippingCopyQuestion =
  "Should the Navbar announcement and the App benefits text also change from $75 to $250, or is the requested change intentionally limited to the shipping progress banner?";
function reportedShippingDiagnosis() {
  return {
    severity: "medium",
    subsystems: [
      "ShippingProgress component",
      "CartDrawer shipping integration",
      "Shipping regression tests",
      "Navbar and benefits promotional copy",
    ],
    actionable: false,
    reproducible: true,
    reason:
      "The free-shipping threshold is defined as 75 in src/components/ShippingProgress.tsx, and the shipping tests assert 75-specific progress, messaging, and cart-subtotal values. The CartDrawer derives the banner subtotal through the existing subtotal function, so the threshold can be changed without altering subtotal or stock logic. Navbar and App also contain customer-facing $75 shipping copy that may become inconsistent.",
    acceptanceCriteria: [
      "The shipping progress banner uses a $250 threshold.",
      "A subtotal of $250 displays the unlocked free-shipping message and 100% progress.",
      "Subtotals below $250 display the correct remaining dollar amount.",
      "Progress remains clamped between 0% and 100%, including negative subtotals and subtotals above $250.",
      "CartDrawer continues to pass the calculated cart subtotal to the shipping banner without changing subtotal calculations.",
      "Existing stock limits and quantity behavior remain unchanged.",
      "Shipping regression tests are updated to cover the $250 threshold, boundary behavior, remaining amount, clamping, and CartDrawer integration.",
      "Any customer-facing shipping threshold copy that is intended to describe the same offer is updated consistently, or its exclusion is documented.",
    ],
    risks: [
      "Leaving the Navbar announcement or App benefits text at $75 would present contradictory shipping information.",
      "Updating threshold-related tests incorrectly could mask regressions in subtotal calculation or progress clamping.",
      "Changes outside the shipping banner could unintentionally affect unrelated cart or stock behavior.",
    ],
    questions: [shippingCopyQuestion],
  };
}
function shippingFixture(
  body = "Update the shipping progress banner to use a $250 threshold. Preserve stock limits and subtotal calculations.",
) {
  const id = fixture();
  write(id, "intake.json", {
    title: "Change the free shipping threshold to $250",
    body,
    labels: [],
    issueId: "12",
    workId: id,
  });
  vi.spyOn(repository, "repositoryContext").mockReturnValue({
    inventory: [
      "src/components/ShippingProgress.tsx",
      "src/components/Navbar.tsx",
      "src/App.tsx",
    ],
    sources: {
      "src/components/ShippingProgress.tsx":
        "export const FREE_SHIPPING_THRESHOLD = 75;",
      "src/components/Navbar.tsx": "<p>Free shipping on orders $75+</p>",
      "src/App.tsx": "<p>Free shipping over $75</p>",
    },
    hashes: {},
  });
  return id;
}
function approvedAcceptance(descriptions: { id: string }[]) {
  return reply({
    valid: true,
    findings: [],
    criteria: descriptions.map((c) => ({
      id: c.id,
      status: "covered",
      evidence: "Real behavior is asserted",
    })),
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  create.mockReset();
  for (const id of workIds.splice(0))
    fs.rmSync(workDir(id), { recursive: true, force: true });
});

describe("repository-aware scope", () => {
  it("allows application integration, styles and docs while protecting pipeline controls", () => {
    for (const p of [
      "src/App.tsx",
      "src/cart.ts",
      "src/index.css",
      "src/types/product.ts",
      "docs/cart.md",
      "README.md",
    ])
      expect(() => safePath(p)).not.toThrow();
    for (const p of [
      ".env",
      "package.json",
      ".github/workflows/issue-pipeline.yml",
      "src/harness/git.ts",
      "src/__tests__/pipeline-quality.test.ts",
      "src/__tests__/setup.ts",
      "src/__tests__/issue-acceptance.test.tsx",
      "src/../README.md",
      "src//cart.ts",
      "src/./cart.ts",
    ])
      expect(() => safePath(p)).toThrow();
    expect(() =>
      validatePaths(["src/cart.ts", "src/__tests__/cart.test.ts"]),
    ).not.toThrow();
    expect(() => validatePaths(["src/cart.ts"])).toThrow("regression");
    expect(() => validatePaths(["src/__tests__/cart.test.ts"])).toThrow(
      "implementation",
    );
    expect(() => validatePaths(["src/cart.ts", "src/cart.ts"])).toThrow(
      "unique",
    );
  });
  it("plans a non-shipping issue instead of using the three shipping paths", async () => {
    aiMode();
    const id = fixture();
    create.mockResolvedValueOnce(
      reply({
        severity: "bug",
        subsystems: ["cart"],
        actionable: true,
        reproducible: true,
        reason: "Subtotal accumulates raw fractional values",
        acceptanceCriteria: criteria.map((c) => c.description),
        risks: ["Stock limits"],
        questions: [],
      }),
    );
    await triager(id, true);
    create.mockResolvedValueOnce(
      reply({
        summary: "Round final subtotal",
        files: [
          { path: "src/cart.ts", reason: "Correct subtotal calculation" },
          {
            path: "src/__tests__/cart-rounding.test.ts",
            reason: "Regression coverage",
          },
        ],
        risks: ["Cart totals"],
        verificationNotes: ["Browser review pending"],
      }),
    );
    create.mockResolvedValueOnce(
      reply({
        code: `import {it,expect} from 'vitest'; import {subtotal} from '../cart'; it('AC-1 handles empty cart',()=>{expect(subtotal([])).toBe(0);});`,
      }),
    );
    const savedDiagnosis = read<{ acceptanceCriteria: string[] }>(
      id,
      "diagnosis.json",
    );
    create.mockResolvedValueOnce(
      approvedAcceptance(
        savedDiagnosis.acceptanceCriteria.map((_, i) => ({
          id: `AC-${i + 1}`,
        })),
      ),
    );
    const draft = await fitter(id, undefined, true);
    expect(draft.paths).toEqual([
      "src/cart.ts",
      "src/__tests__/cart-rounding.test.ts",
    ]);
    expect(draft.acceptanceCriteria).toEqual(criteria);
    expect(draft.acceptanceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(create.mock.calls.map((c) => c[0].text.format.name)).toEqual([
      "triager",
      "fitter",
      "acceptance_tests",
      "acceptance_review",
    ]);
    expect(
      create.mock.calls.every(
        (c) => c[0].store === false && c[0].text.format.strict === true,
      ),
    ).toBe(true);
  });
  it("implements a general fitted plan and passes a separate evidence-based reviewer", async () => {
    aiMode();
    const id = fixture();
    const paths = ["src/cart.ts", "src/__tests__/cart-rounding.test.ts"];
    vi.spyOn(common, "safePath").mockImplementation((p) =>
      path.join(workDir(id), "fixture", p),
    );
    vi.spyOn(common, "fingerprint").mockReturnValue("fixture-code");
    const code =
      "export function subtotal(items: {price: number}[]) {return Math.round(items.reduce((total, item) => total + item.price, 0) * 100) / 100;}";
    write(id, "cost-approval.json", { approvedCost: true });
    write(id, "acceptance-tests.json", {
      code: "it('AC-1 empty cart',()=>{expect(subtotal([])).toBe(0);});",
    });
    const draft = {
      qualityVersion: 2,
      mode: "openai",
      paths,
      hashes: Object.fromEntries(paths.map((p) => [p, null])),
      contextHashes: {},
      acceptanceCriteria: criteria,
      acceptanceHash: qualityHash(id, "acceptance-tests.json"),
      approvedCost: true,
      issue: read(id, "intake.json"),
    } as Draft;
    write(id, "draft.json", draft);
    create.mockResolvedValueOnce(
      reply({
        "src/cart.ts": code,
        "src/__tests__/cart-rounding.test.ts":
          "import {it,expect} from 'vitest'; import {subtotal} from '../cart'; it('rounds subtotal',()=>{expect(subtotal([{price: 0.101}])).toBe(0.1);});",
      }),
    );
    expect((await developer(id)).changedFiles).toEqual(paths);
    expect(
      fs.readFileSync(path.join(workDir(id), "fixture/src/cart.ts"), "utf8"),
    ).toContain("Math.round");
    create.mockResolvedValueOnce(
      reply({
        summary: "Requirements covered by source and tests",
        criteria: [
          {
            id: "AC-1",
            status: "met",
            evidence: "Subtotal uses final rounding and regression assertions",
          },
        ],
        findings: [],
      }),
    );
    const review = await reviewer(id, [], 0);
    expect(review.status).toBe("passed");
    expect(create.mock.calls.map((c) => c[0].text.format.name)).toEqual([
      "developer",
      "reviewer",
    ]);
    expect(create.mock.calls[1][0].input).toContain("originalSources");
    expect(create.mock.calls[1][0].input).toContain("finalSources");
  });
  it("resolves the exact issue #12 triage failure and plans all shipping offer touchpoints", async () => {
    aiMode();
    const id = shippingFixture();
    create.mockResolvedValueOnce(reply(reportedShippingDiagnosis()));
    create.mockResolvedValueOnce(
      reply({
        supported: true,
        reason: "One threshold governs the same shipping offer",
        resolutions: [
          {
            question: shippingCopyQuestion,
            blocking: false,
            assumption:
              "Update the Navbar and App free-shipping copy to $250 along with the banner.",
            rationale:
              "The issue changes the free-shipping threshold and existing source describes the same offer in all three locations.",
          },
        ],
      }),
    );
    const diagnosis = await triager(id, true);
    expect(diagnosis.actionable).toBe(true);
    expect(diagnosis.questions).toEqual([]);
    expect(diagnosis.assumptions?.[0]).toContain("Navbar and App");
    expect(
      read<{ actionable: boolean }>(id, "triage-initial.json").actionable,
    ).toBe(false);
    expect(
      read<{ supported: boolean }>(id, "triage-resolution.json").supported,
    ).toBe(true);
    const planned = [
      "src/components/ShippingProgress.tsx",
      "src/components/CartDrawer.tsx",
      "src/components/Navbar.tsx",
      "src/App.tsx",
      "src/__tests__/shipping.test.tsx",
    ];
    create.mockResolvedValueOnce(
      reply({
        summary: "Apply the $250 offer consistently",
        files: planned.map((path) => ({
          path,
          reason: "Shipping offer implementation and regression coverage",
        })),
        risks: ["Preserve cart subtotal and stock"],
        verificationNotes: [],
      }),
    );
    create.mockResolvedValueOnce(
      reply({
        code:
          "import {it,expect} from 'vitest'; import {FREE_SHIPPING_THRESHOLD} from '../components/ShippingProgress';" +
          diagnosis
            .acceptanceCriteria!.map(
              (_, i) =>
                `it('AC-${i + 1} shipping criterion',()=>{expect(FREE_SHIPPING_THRESHOLD).toBe(250);});`,
            )
            .join("\n"),
      }),
    );
    const savedDiagnosis = read<{ acceptanceCriteria: string[] }>(
      id,
      "diagnosis.json",
    );
    create.mockResolvedValueOnce(
      approvedAcceptance(
        savedDiagnosis.acceptanceCriteria.map((_, i) => ({
          id: `AC-${i + 1}`,
        })),
      ),
    );
    const draft = await fitter(id, undefined, true);
    expect(draft.paths).toEqual(planned);
    expect(draft.assumptions).toEqual(diagnosis.assumptions);
    expect(draft.acceptanceCriteria).toHaveLength(8);
    expect(create.mock.calls.map((c) => c[0].text.format.name)).toEqual([
      "triager",
      "triage_resolution",
      "fitter",
      "acceptance_tests",
      "acceptance_review",
    ]);
    expect(
      JSON.parse(create.mock.calls[2][0].input).diagnosis.assumptions[0],
    ).toContain("$250");
  });
  it("preserves an explicit exclusion instead of widening the shipping change", async () => {
    aiMode();
    const id = shippingFixture(
      "Update only the banner to $250. Do not change Navbar or App promotional copy; they describe a separate offer.",
    );
    create.mockResolvedValueOnce(reply(reportedShippingDiagnosis()));
    create.mockResolvedValueOnce(
      reply({
        supported: true,
        reason: "The issue explicitly defines the scope",
        resolutions: [
          {
            question: shippingCopyQuestion,
            blocking: false,
            assumption:
              "Leave Navbar and App copy unchanged as explicitly requested.",
            rationale:
              "The issue says those locations describe a separate offer and excludes them.",
          },
        ],
      }),
    );
    const diagnosis = await triager(id, true);
    expect(diagnosis.actionable).toBe(true);
    expect(diagnosis.assumptions?.[0]).toContain("unchanged");
    expect(JSON.parse(create.mock.calls[1][0].input).issue.body).toContain(
      "Do not change Navbar or App",
    );
    expect(create.mock.calls[1][0].instructions).toContain(
      "Respect explicit exclusions",
    );
  });
  it("rejects a resolution that omits or fails to justify a triage question", async () => {
    aiMode();
    const id = shippingFixture();
    create.mockResolvedValueOnce(reply(reportedShippingDiagnosis()));
    create.mockResolvedValueOnce(
      reply({ supported: true, reason: "Proceed", resolutions: [] }),
    );
    await expect(triager(id, true)).rejects.toThrow(
      "Incomplete triage question resolution",
    );
    expect(fs.existsSync(path.join(workDir(id), "diagnosis.json"))).toBe(false);
  });
  it("stops ambiguous requirements before planning", async () => {
    aiMode();
    const id = fixture();
    write(id, "intake.json", {
      title: "Add price rounding",
      body: "Handle fractional prices according to company policy.",
      labels: [],
      issueId: "1",
      workId: id,
    });
    create.mockResolvedValueOnce(
      reply({
        severity: "enhancement",
        subsystems: ["cart"],
        actionable: true,
        reproducible: false,
        reason: "Unclear rounding policy",
        acceptanceCriteria: ["Round totals"],
        risks: [],
        questions: ["Round each item or the final subtotal?"],
      }),
    );
    create.mockResolvedValueOnce(
      reply({
        supported: true,
        reason: "Company rounding policy is not in the issue or source",
        resolutions: [
          {
            question: "Round each item or the final subtotal?",
            blocking: true,
            assumption: "",
            rationale:
              "This choice changes charged totals and requires the company policy.",
          },
        ],
      }),
    );
    expect((await triager(id, true)).actionable).toBe(false);
    await expect(fitter(id, undefined, true)).rejects.toThrow("clarification");
    expect(create).toHaveBeenCalledTimes(2);
  });
  it("rejects a planner that requests harness changes", async () => {
    aiMode();
    const id = fixture();
    write(id, "cost-approval.json", { approvedCost: true });
    write(id, "diagnosis.json", {
      mode: "openai",
      actionable: true,
      acceptanceCriteria: ["Meet cart behavior"],
      questions: [],
      issue: read(id, "intake.json"),
    });
    create.mockResolvedValueOnce(
      reply({
        summary: "Disable review",
        files: [
          { path: "src/harness/git.ts", reason: "Bypass check" },
          { path: "src/__tests__/cart.test.ts", reason: "Tests" },
        ],
        risks: [],
        verificationNotes: [],
      }),
    );
    await expect(fitter(id, undefined, true)).rejects.toThrow("scope");
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("keeps offline mode explicitly limited to shipping", async () => {
    vi.stubEnv("HARNESS_MODE", "offline");
    const id = fixture();
    expect((await triager(id)).actionable).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("acceptance and review gates", () => {
  it("retains issue 17 visual checks in the frozen acceptance contract and draft", async () => {
    aiMode();
    const id = fixture();
    const stylingCriteria = [
      {
        id: "AC-1",
        description:
          "Define radius tokens and visually inspect desktop and mobile clipping",
      },
    ];
    write(id, "cost-approval.json", { approvedCost: true });
    write(id, "diagnosis.json", {
      issue: read<Issue>(id, "intake.json"),
      mode: "openai",
      actionable: true,
      reason: "Rounded surfaces",
      acceptanceCriteria: stylingCriteria.map((c) => c.description),
      risks: [],
      questions: [],
    });
    create.mockResolvedValueOnce(
      reply({
        summary: "Use shared radius tokens",
        files: [
          { path: "src/index.css", reason: "Radius tokens and selectors" },
          {
            path: "src/__tests__/radii.test.ts",
            reason: "CSS contract regression",
          },
        ],
        risks: [],
        verificationNotes: [],
      }),
    );
    const steps = [
      "At 1280px desktop and 375px mobile, open the cart and inspect product images, drawer edge backgrounds and rounded clipping; images must stay inside their surfaces.",
      "At both viewports, tab through search, filters, size controls, cart close and quantity buttons; every focus outline must remain visible without clipping.",
    ];
    create.mockResolvedValueOnce(
      reply({
        code: `import {it,expect} from 'vitest'; import {readFileSync} from 'node:fs'; const css=readFileSync(new URL('../index.css',import.meta.url),'utf8'); it('AC-1 radius tokens',()=>{expect(css).toMatch(/--radius-sm:/);expect(css).toMatch(/--radius-lg:/);});`,
        manualVerification: [{ criterionId: "AC-1", steps }],
      }),
    );
    create.mockResolvedValueOnce(approvedAcceptance(stylingCriteria));
    const draft = await fitter(id, undefined, true);
    expect(
      read<{ manualVerification: unknown }>(id, "acceptance-tests.json")
        .manualVerification,
    ).toEqual([{ criterionId: "AC-1", steps }]);
    expect(draft.verificationNotes).toEqual(
      steps.map((step) => `Pending manual verification (AC-1): ${step}`),
    );
    const generator = create.mock.calls[1][0];
    const review = create.mock.calls[2][0];
    expect(generator.instructions).toContain(
      "getByRole('button', {name: 'Graphic Tees'})",
    );
    expect(generator.instructions).toContain(
      "close buttons, quantity buttons, size controls",
    );
    expect(generator.text.format.schema.required).toContain(
      "manualVerification",
    );
    expect(review.instructions).toContain(
      "not results of browser checks that cannot have run yet",
    );
    expect(
      JSON.parse(review.input).candidateAcceptanceTests.manualVerification,
    ).toEqual([{ criterionId: "AC-1", steps }]);
    expect(draft.acceptanceHash).toBe(qualityHash(id, "acceptance-tests.json"));
  });

  it("rejects malformed manual checklists without bypassing executable acceptance", () => {
    const code = `it('AC-1 subtotal',()=>{expect(subtotal([])).toBe(0);});`;
    for (const manualVerification of [
      [{ criterionId: "AC-99", steps: ["Inspect the cart"] }],
      [{ criterionId: "AC-1", steps: [] }],
      [{ criterionId: "AC-1", steps: [" "] }],
      [
        { criterionId: "AC-1", steps: ["Inspect"] },
        { criterionId: "AC-1", steps: ["Inspect again"] },
      ],
    ]) {
      expect(() =>
        validateAcceptance({ code, manualVerification }, criteria),
      ).toThrow("Manual verification");
    }
    expect(() =>
      validateAcceptance(
        {
          code: "",
          manualVerification: [{ criterionId: "AC-1", steps: ["Inspect"] }],
        },
        criteria,
      ),
    ).toThrow("real assertions");
  });

  it("rejects the live duplicate-status test and permits properly isolated renders", () => {
    const faulty = `it('AC-1 state changes',()=>{render(<ShippingProgress subtotal={0}/>);expect(screen.getByRole('status')).toBeTruthy();render(<ShippingProgress subtotal={250}/>);expect(screen.getByRole('status')).toBeTruthy();});`;
    expect(() => validateAcceptance({ code: faulty }, criteria)).toThrow(
      "multiple roots",
    );
    const rerender = `it('AC-1 state changes',()=>{const view=render(<ShippingProgress subtotal={0}/>);expect(screen.getByRole('status')).toBeTruthy();view.rerender(<ShippingProgress subtotal={250}/>);expect(screen.getByRole('status')).toBeTruthy();});`;
    expect(() =>
      validateAcceptance({ code: rerender }, criteria),
    ).not.toThrow();
    const unmount = faulty
      .replace(
        "render(<ShippingProgress subtotal={0}/>)",
        "const view=render(<ShippingProgress subtotal={0}/>)",
      )
      .replace(
        "render(<ShippingProgress subtotal={250}/>)",
        "view.unmount();render(<ShippingProgress subtotal={250}/>)",
      );
    expect(() => validateAcceptance({ code: unmount }, criteria)).not.toThrow();
  });
  it("regenerates invalid acceptance tests before freezing their contract", async () => {
    aiMode();
    const id = fixture();
    write(id, "cost-approval.json", { approvedCost: true });
    create.mockResolvedValueOnce(
      reply({
        code: `it('AC-1 behavior',()=>{render(<A/>);render(<B/>);expect(screen.getByRole('status')).toBeTruthy();});`,
      }),
    );
    create.mockResolvedValueOnce(
      reply({
        code: `it('AC-1 behavior',()=>{expect(subtotal([])).toBe(0);});`,
      }),
    );
    create.mockResolvedValueOnce(approvedAcceptance(criteria));
    const diagnosis = {
      issue: read<Issue>(id, "intake.json"),
      actionable: true,
      reason: "Subtotal",
      severity: "bug",
      subsystems: ["cart"],
      reproducible: true,
    };
    const tests = await prepareAcceptance(
      id,
      diagnosis,
      criteria,
      {},
      repository.repositoryContext(),
    );
    expect(tests.code).toContain("subtotal([])");
    expect(
      read<{ findings: string[] }>(id, "acceptance-generation-0.json")
        .findings[0],
    ).toContain("multiple roots");
    expect(create.mock.calls.map((c) => c[0].text.format.name)).toEqual([
      "acceptance_tests",
      "acceptance_tests",
      "acceptance_review",
    ]);
    expect(
      JSON.parse(create.mock.calls[1][0].input).validationFindings[0],
    ).toContain("multiple roots");
  });

  it("repairs issue 16 duplicate queries using independent review feedback", async () => {
    aiMode();
    const id = fixture();
    write(id, "cost-approval.json", { approvedCost: true });
    const cartCriteria = [
      { id: "AC-7", description: "Preserve cart behavior" },
    ];
    const faulty = `it('AC-7 cart behavior',()=>{render(<App/>);fireEvent.click(screen.getAllByRole('button',{name:/Add to bag/})[0]);fireEvent.click(screen.getByRole('button',{name:'Increase Out of Office'}));expect(screen.getByText('$64.00')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Checkout'}));expect(screen.getByRole('status')).toHaveTextContent(/Demo checkout ready/);});`;
    const corrected = faulty
      .replace(
        "expect(screen.getByText('$64.00')).toBeInTheDocument()",
        "expect(screen.getAllByText('$64.00')).toHaveLength(2)",
      )
      .replace(
        "expect(screen.getByRole('status')).toHaveTextContent(/Demo checkout ready/)",
        "expect(screen.getByText(/Demo checkout ready/)).toHaveAttribute('role','status')",
      );
    const findings = [
      "AC-7: item price and subtotal both render $64.00; use a scoped or plural query.",
      "AC-7: shipping and checkout both have role status; select the checkout message uniquely.",
    ];
    create.mockResolvedValueOnce(reply({ code: faulty }));
    create.mockResolvedValueOnce(
      reply({
        valid: false,
        findings,
        criteria: [
          { id: "AC-7", status: "missing", evidence: "Ambiguous queries" },
        ],
      }),
    );
    create.mockResolvedValueOnce(reply({ code: corrected }));
    create.mockResolvedValueOnce(approvedAcceptance(cartCriteria));
    const diagnosis = {
      issue: read<Issue>(id, "intake.json"),
      actionable: true,
      reason: "Rounded styling with unchanged cart behavior",
      severity: "P3",
      subsystems: ["cart"],
      reproducible: true,
    };
    const tests = await prepareAcceptance(
      id,
      diagnosis,
      cartCriteria,
      {},
      repository.repositoryContext(),
    );
    expect(tests.code).toContain('getAllByText("$64.00")');
    expect(tests.code).toContain("getByText(/Demo checkout ready/)");
    const repairRequest = create.mock.calls[2][0];
    const repairInput = JSON.parse(repairRequest.input);
    expect(repairInput.previousTests.code).toContain('getByText("$64.00")');
    expect(repairInput.validationFindings).toEqual(
      expect.arrayContaining(findings),
    );
    expect(repairRequest.instructions).toContain("REPAIR of previousTests");
    expect(repairRequest.instructions).toContain(
      "One render can still contain duplicate text or roles",
    );
    expect(
      read<{ status: string }>(id, "acceptance-generation-1.json").status,
    ).toBe("approved");
  });

  it("repairs issue 18 cart stock and downstream totals before freezing acceptance", async () => {
    aiMode();
    const id = fixture();
    write(id, "cost-approval.json", { approvedCost: true });
    const cartCriteria = [
      { id: "AC-5", description: "Preserve cart and stock behavior" },
    ];
    const faulty = `it('AC-5 cart behavior',()=>{expect(items[0].quantity).toBe(12);expect(within(dialog).getAllByText('$352.00')).toHaveLength(2);});`;
    const corrected = `it('AC-5 cart behavior',()=>{expect(items[0].quantity).toBe(11);expect(items[1].quantity).toBe(1);expect(subtotal(items)).toBe(384);items=changeQuantity(items,cartKey(items[0]),-1);expect(items[0].quantity).toBe(10);expect(items[0].quantity*items[0].product.price).toBe(320);expect(subtotal(items)).toBe(352);});`;
    const findings = [
      "AC-5: stock 12 is shared across variants; with the second at 1, the first is capped at 11.",
      "AC-5: recompute downstream totals and scope item prices separately from the subtotal.",
    ];
    create.mockResolvedValueOnce(reply({ code: faulty }));
    create.mockResolvedValueOnce(
      reply({
        valid: false,
        findings,
        criteria: [
          {
            id: "AC-5",
            status: "missing",
            evidence: "Invalid cart state and subtotal",
          },
        ],
      }),
    );
    create.mockResolvedValueOnce(reply({ code: corrected }));
    create.mockResolvedValueOnce(approvedAcceptance(cartCriteria));
    const tests = await prepareAcceptance(
      id,
      {
        issue: read<Issue>(id, "intake.json"),
        actionable: true,
        reason: "Rounded styling with unchanged cart behavior",
        severity: "P2",
        subsystems: ["cart"],
        reproducible: true,
      },
      cartCriteria,
      {},
      repository.repositoryContext(),
    );

    expect(tests.code).toContain("toBe(384)");
    expect(tests.code).toContain("toBe(352)");
    const repair = create.mock.calls[2][0];
    expect(JSON.parse(repair.input).validationFindings).toEqual(findings);
    expect(JSON.parse(repair.input).previousTests.code).toContain("toBe(12)");
    expect(repair.instructions).toContain(
      "recompute EVERY downstream line total",
    );
    for (const [request] of create.mock.calls) {
      expect(request.instructions).toContain(
        "Stock is shared across ALL size/color variants",
      );
      expect(request.instructions).toContain(
        "line totals $320 and $32, subtotal $352",
      );
    }
    expect(
      read<{ status: string }>(id, "acceptance-generation-0.json").status,
    ).toBe("invalid");
    expect(
      read<{ status: string }>(id, "acceptance-generation-1.json").status,
    ).toBe("approved");
  });

  it("keeps the acceptance gate closed and explains exhausted generation attempts", async () => {
    aiMode();
    const id = fixture();
    write(id, "cost-approval.json", { approvedCost: true });
    const findings = ["Cart status query is ambiguous"];
    for (let attempt = 0; attempt < 3; attempt++) {
      create.mockResolvedValueOnce(
        reply({
          code: `it('AC-1 cart',()=>{expect(screen.getByRole('status')).toBeTruthy();});`,
        }),
      );
      create.mockResolvedValueOnce(
        reply({
          valid: false,
          findings,
          criteria: [
            { id: "AC-1", status: "covered", evidence: "status assertion" },
          ],
        }),
      );
    }
    await expect(
      prepareAcceptance(
        id,
        {
          issue: read<Issue>(id, "intake.json"),
          actionable: true,
          reason: "Cart",
          severity: "P3",
          subsystems: ["cart"],
          reproducible: true,
        },
        criteria,
        {},
        repository.repositoryContext(),
      ),
    ).rejects.toThrow("after 3 attempts");
    expect(create).toHaveBeenCalledTimes(6);
    const summary = fs.readFileSync(
      path.join(workDir(id), "investigation.md"),
      "utf8",
    );
    expect(summary).toContain("Product implementation has not started");
    expect(summary).toContain(findings[0]);
    expect(summary).toContain("acceptance-generation-2.json");
    expect(fs.existsSync(path.join(workDir(id), "acceptance-tests.json"))).toBe(
      false,
    );
  });

  it("rejects missing, skipped, mocked and assertion-free acceptance tests", () => {
    const good = `it('AC-1 behavior', () => { expect(subtotal([])).toBe(0); });`;
    expect(() => validateAcceptance({ code: good }, criteria)).not.toThrow();
    for (const code of [
      "it('AC-1 behavior', () => {});",
      good.replace("AC-1", "AC-2"),
      good.replace("it(", "it.skip("),
      good + "vi.mock('../cart')",
      good + "// @ts-nocheck",
    ])
      expect(() => validateAcceptance({ code }, criteria)).toThrow();
  });
  it("requires actual passing assertions for every criterion, with no skipped tests", () => {
    const report = (assertionResults: unknown[]) => ({
      testResults: [{ assertionResults }],
    });
    expect(
      acceptanceReportPassed(
        report([{ fullName: "cart AC-1 empty subtotal", status: "passed" }]),
        criteria,
      ),
    ).toBe(true);
    for (const assertions of [
      [],
      [{ fullName: "AC-2 irrelevant", status: "passed" }],
      [{ fullName: "AC-1 subtotal", status: "pending" }],
      [
        { fullName: "AC-1 subtotal", status: "passed" },
        { fullName: "another test", status: "pending" },
      ],
    ])
      expect(acceptanceReportPassed(report(assertions), criteria)).toBe(false);
  });
  it("blocks incomplete, duplicated or failed verification evidence", () => {
    const checks = requiredChecks.map((name) => ({
      name,
      status: "passed",
      exitCode: 0,
    }));
    expect(() => validateQualityChecks(checks)).not.toThrow();
    for (const invalid of [
      checks.slice(0, 3),
      [...checks.slice(1), checks[1]],
      checks.map((c) => (c.name === "review" ? { ...c, exitCode: 1 } : c)),
    ])
      expect(() => validateQualityChecks(invalid)).toThrow();
  });
  it("blocks unmet requirements and P0-P2 findings even when tests pass", () => {
    const draft = { acceptanceCriteria: criteria } as Draft;
    const review = {
      criteria: [
        { id: "AC-1", status: "met", evidence: "Actual subtotal asserted" },
      ],
      findings: [],
    };
    expect(reviewPassed(review, draft)).toBe(true);
    expect(reviewPassed({ ...review, criteria: [] }, draft)).toBe(false);
    expect(
      reviewPassed(
        { ...review, criteria: [...review.criteria, ...review.criteria] },
        draft,
      ),
    ).toBe(false);
    expect(
      reviewPassed(
        { ...review, criteria: [{ ...review.criteria[0], status: "unmet" }] },
        draft,
      ),
    ).toBe(false);
    expect(
      reviewPassed(
        {
          ...review,
          findings: [
            {
              priority: "P2",
              path: "src/cart.ts",
              description: "Rounding breaks totals",
            },
          ],
        },
        draft,
      ),
    ).toBe(false);
  });
  it("detects acceptance contract tampering before developer writes", async () => {
    const id = fixture();
    write(id, "draft.json", {
      qualityVersion: 2,
      paths: [],
      hashes: {},
      acceptanceHash: "stale",
    });
    write(id, "acceptance-tests.json", { code: "Changed tests" });
    await expect(developer(id)).rejects.toThrow("contract");
    expect(create).not.toHaveBeenCalled();
  });
  it("binds commit readiness to code, plan, tests and review evidence", () => {
    const id = fixture();
    vi.spyOn(common, "fingerprint").mockReturnValue("tested-code");
    write(id, "acceptance-tests.json", {
      code: "original acceptance contract",
    });
    const draft = {
      qualityVersion: 2,
      acceptanceCriteria: criteria,
      acceptanceHash: qualityHash(id, "acceptance-tests.json"),
    } as Draft;
    write(id, "draft.json", draft);
    const tests = {
      status: "passed",
      fingerprint: "tested-code",
      draftHash: qualityHash(id, "draft.json"),
      acceptanceHash: draft.acceptanceHash,
      checks: requiredChecks.map((name) => ({
        name,
        status: "passed",
        exitCode: 0,
      })),
    } as TestRecord;
    const review = {
      status: "passed",
      fingerprint: tests.fingerprint,
      draftHash: tests.draftHash,
      acceptanceHash: tests.acceptanceHash,
      criteria: [
        { id: "AC-1", status: "met", evidence: "Public behavior tested" },
      ],
      findings: [],
    } as unknown as Review;
    expect(() => assertReady(id, draft, tests, review)).not.toThrow();
    expect(() =>
      assertReady(id, draft, { ...tests, fingerprint: "old-code" }, review),
    ).toThrow("Fresh");
    expect(() =>
      assertReady(id, draft, tests, { ...review, draftHash: "old-plan" }),
    ).toThrow("Fresh");
    write(id, "acceptance-tests.json", {
      code: "weakened acceptance contract",
    });
    expect(() => assertReady(id, draft, tests, review)).toThrow("Fresh");
  });
  it("rejects publication when HEAD or evidence does not match", () => {
    const id = fixture();
    write(id, "git-record.json", {
      clean: false,
      status: "awaiting-human-approval",
      sha: "0".repeat(40),
      branch: "codex/fake",
      artifactHashes: {},
    });
    expect(() => verifyPublication(id)).toThrow("reviewed commit");
  });
});

describe("API execution boundaries", () => {
  it("requires saved approval and fails closed on incomplete responses", async () => {
    aiMode();
    const id = fixture();
    write(id, "cost-approval.json", { approvedCost: false });
    await expect(
      ask(id, "triager", "test", {}, objectSchema({ value: stringSchema })),
    ).rejects.toThrow("cost approval");
    expect(create).not.toHaveBeenCalled();
    write(id, "cost-approval.json", { approvedCost: true });
    create.mockResolvedValueOnce({
      id: "incomplete",
      status: "incomplete",
      output_text: '{"value":"partial"}',
    });
    await expect(
      ask(id, "triager", "test", {}, objectSchema({ value: stringSchema })),
    ).rejects.toThrow("incomplete");
    expect(
      read<{ calls: { status: string }[] }>(id, "api-usage.json").calls[0]
        .status,
    ).toBe("failed");
  });
  it("does not reset the request budget when the usage ledger is corrupted", async () => {
    aiMode();
    const id = fixture();
    write(id, "cost-approval.json", { approvedCost: true });
    fs.writeFileSync(path.join(workDir(id), "api-usage.json"), "corrupted");
    await expect(
      ask(id, "triager", "test", {}, objectSchema({ value: stringSchema })),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
  it("retries a temporary rate limit and records each request against the budget", async () => {
    aiMode();
    const id = fixture();
    write(id, "cost-approval.json", { approvedCost: true });
    vi.useFakeTimers();
    try {
      create.mockRejectedValueOnce({
        status: 429,
        headers: new Headers({ "retry-after": "1" }),
      });
      create.mockResolvedValueOnce(reply({ value: "ok" }));
      const result = ask<{ value: string }>(
        id,
        "triager",
        "test",
        {},
        objectSchema({ value: stringSchema }),
      );
      await vi.advanceTimersByTimeAsync(1500);
      expect(await result).toEqual({ value: "ok" });
      const ledger = read<{
        calls: { status: string; retryDelayMs: number }[];
      }>(id, "api-usage.json");
      expect(ledger.calls.map((c) => c.status)).toEqual([
        "retrying",
        "completed",
      ]);
      expect(ledger.calls[0].retryDelayMs).toBeGreaterThanOrEqual(1000);
      expect(create).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("stops without retrying when credits are exhausted and saves diagnostics", async () => {
    aiMode();
    const id = fixture();
    write(id, "cost-approval.json", { approvedCost: true });
    create.mockRejectedValueOnce({
      status: 429,
      code: "insufficient_quota",
      message: "No credits remaining",
    });
    await expect(
      ask(id, "triager", "test", {}, objectSchema({ value: stringSchema })),
    ).rejects.toMatchObject({ status: 429 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(read<{ kind: string }>(id, "api-failure.json").kind).toBe("quota");
    expect(
      read<{ calls: { status: string }[] }>(id, "api-usage.json").calls.map(
        (call) => call.status,
      ),
    ).toEqual(["failed"]);
  });
  it("caps paid requests, including failed calls", async () => {
    aiMode();
    const id = fixture();
    write(id, "cost-approval.json", { approvedCost: true });
    write(id, "api-usage.json", {
      calls: Array.from({ length: 16 }, () => ({ status: "failed" })),
    });
    await expect(
      ask(id, "triager", "test", {}, objectSchema({ value: stringSchema })),
    ).rejects.toThrow("budget");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("repair loop infrastructure failures", () => {
  it.each(["provider", "runner"])(
    "stops immediately when a %s failure appears after a repair",
    async (kind) => {
      const id = fixture();
      write(id, "draft.json", { maxCycles: 3 });
      const initial = {
        status: "failed",
        cycle: 0,
        fingerprint: "before-repair",
        checks: [
          {
            name: "test",
            status: "failed",
            exitCode: 1,
            log: "Assertion failed",
          },
        ],
      } as TestRecord;
      write(id, "test-record.json", initial);
      vi.spyOn(common, "fingerprint").mockReturnValue("after-repair");
      const repair = vi.spyOn(developerWorker, "developer").mockResolvedValue({
        mode: "openai",
        repair: true,
        changedFiles: ["src/cart.ts"],
        hashes: {},
        applied: true,
      });
      const next = {
        ...initial,
        cycle: 1,
        fingerprint: "after-repair",
        checks:
          kind === "provider"
            ? [
                {
                  name: "review",
                  status: "failed",
                  exitCode: 1,
                  log: "No credits remaining",
                  failureKind: "provider" as const,
                },
              ]
            : [
                {
                  name: "test",
                  status: "failed",
                  exitCode: null,
                  signal: "SIGKILL",
                  log: "ETIMEDOUT",
                },
              ],
      } as TestRecord;
      vi.spyOn(testerWorker, "tester").mockImplementation(async () =>
        write(id, "test-record.json", next),
      );
      await expect(fixer(id)).rejects.toThrow(
        kind === "provider" ? "Review provider unavailable" : "Runner failure",
      );
      expect(repair).toHaveBeenCalledTimes(1);
      expect(read<{ attempts: unknown[] }>(id, "cycles.json").attempts).toEqual(
        [{ cycle: 1, status: "failed" }],
      );
      expect(
        fs.readFileSync(path.join(workDir(id), "investigation.md"), "utf8"),
      ).toContain(kind === "provider" ? "provider failure" : "Runner failure");
    },
  );
});
