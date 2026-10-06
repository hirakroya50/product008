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
import { safePath, write, read, workDir, type Draft } from "../harness/common";
import { validatePaths } from "../harness/repository";
import { reviewPassed, reviewer } from "../harness/workers/reviewer";
import { triager } from "../harness/workers/triager";
import { fitter } from "../harness/workers/fitter";
import { developer } from "../harness/workers/developer";
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
  it("stops ambiguous requirements before planning", async () => {
    aiMode();
    const id = fixture();
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
    expect((await triager(id, true)).actionable).toBe(false);
    await expect(fitter(id, undefined, true)).rejects.toThrow("clarification");
    expect(create).toHaveBeenCalledTimes(1);
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
