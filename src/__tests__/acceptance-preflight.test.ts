// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptancePreflight,
  thresholdProbe,
} from "../harness/acceptance-preflight";
import { validateRuntimeReview } from "../harness/workers/acceptance";
import { validateAcceptance } from "../harness/quality";
import { read, root, workDir, type Issue } from "../harness/common";
vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
const ids: string[] = [];
function fixture() {
  const id = `work-preflight-${randomUUID()}`;
  ids.push(id);
  return id;
}
const criteria = [{ id: "AC-1", description: "Correct shipping progress" }];
const issue: Issue = {
  title: "Change the free shipping threshold to $299",
  body: "Preserve cart calculations.",
  labels: [],
  issueId: "21",
  workId: "unused",
};
const candidate = {
  code: `it('AC-1 progress',()=>{expect(shippingProgress(64)).toBe(0);});`,
};
function processResult(status = 0, stdout = "") {
  return { status, stdout, stderr: "", signal: null } as ReturnType<
    typeof spawnSync
  >;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(spawnSync).mockReset();
  for (const id of ids.splice(0))
    fs.rmSync(workDir(id), { recursive: true, force: true });
});

describe("executable acceptance preflight", () => {
  it("sends compiler errors back to generation and removes its temporary copy", () => {
    const id = fixture();
    vi.mocked(spawnSync).mockReturnValue(
      processResult(
        2,
        "issue-acceptance.test.tsx(42,3): error TS2322: unknown[] is not assignable to CSSRule[]",
      ),
    );
    const result = acceptancePreflight(id, 0, candidate, criteria, issue);
    expect(result.blockers[0]).toContain("TS2322");
    expect(spawnSync).toHaveBeenCalledTimes(1);
    const [command, args, options] = vi.mocked(spawnSync).mock.calls[0];
    expect(command).toBe("/usr/bin/sandbox-exec");
    expect(args?.[1]).toContain("(deny network*)");
    expect(options?.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(fs.existsSync(String(options?.cwd))).toBe(false);
    expect(read(id, "acceptance-preflight-0.json")).toEqual(result);
  });

  it("executes the actual candidate and preserves partial-progress failures in a threshold probe", () => {
    const id = fixture();
    const shipping = path.join(root, "src/components/ShippingProgress.tsx");
    const original = fs.readFileSync(shipping, "utf8");
    let runs = 0;
    vi.mocked(spawnSync).mockImplementation((_command, args, options) => {
      if (args?.includes("typecheck")) return processResult();
      const dir = String(options?.cwd);
      runs++;
      expect(
        fs.readFileSync(
          path.join(dir, "src/__tests__/issue-acceptance.test.tsx"),
          "utf8",
        ),
      ).toBe(candidate.code);
      const source = fs.readFileSync(
        path.join(dir, "src/components/ShippingProgress.tsx"),
        "utf8",
      );
      expect(source).toBe(
        runs === 1 ? original : thresholdProbe(original, issue)!.source,
      );
      const message =
        runs === 1
          ? "Expected new threshold"
          : 'Expected value="0", received value="21.40468227424749"';
      fs.writeFileSync(
        path.join(dir, "preflight-results.json"),
        JSON.stringify({
          success: false,
          testResults: [
            {
              name: path.join(dir, "src/__tests__/issue-acceptance.test.tsx"),
              assertionResults: [
                {
                  fullName: "AC-1 progress",
                  status: "failed",
                  failureMessages: [message],
                },
              ],
            },
          ],
        }),
      );
      return processResult(1);
    });
    const result = acceptancePreflight(id, 1, candidate, criteria, issue);
    expect(runs).toBe(2);
    expect(result.blockers).toEqual([]);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[1]).toMatchObject({
      scenario: "requested-threshold-probe",
      message: expect.stringContaining("21.40468227424749"),
    });
    expect(fs.readFileSync(shipping, "utf8")).toBe(original);
    expect(
      fs.existsSync(
        path.join(
          workDir(id),
          "acceptance-preflight-1-requested-threshold-probe.json",
        ),
      ),
    ).toBe(true);
  });

  it("does not consume generation retries for a runner timeout", () => {
    vi.mocked(spawnSync).mockReturnValue({
      ...processResult(),
      status: null,
      signal: "SIGKILL",
      error: new Error("ETIMEDOUT"),
    });
    expect(() =>
      acceptancePreflight(fixture(), 0, candidate, criteria, issue),
    ).toThrow("preflight runner failed");
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it("rejects the issue 20 imported-CSS harness but permits source-level assertions", () => {
    for (const expression of [
      "getComputedStyle(document.documentElement)",
      "window.getComputedStyle(document.body)",
      "document.styleSheets",
    ]) {
      expect(() =>
        validateAcceptance(
          {
            code: `import '../index.css'; it('AC-1 tokens',()=>{expect(${expression}).toBeTruthy();});`,
          },
          criteria,
        ),
      ).toThrow("Imported CSS is not loaded");
    }
    expect(() =>
      validateAcceptance(
        {
          code: `import {readFileSync} from 'node:fs'; const css=readFileSync(new URL('../index.css',import.meta.url),'utf8'); it('AC-1 tokens',()=>{expect(css).toMatch(/--radius-sm:/);});`,
        },
        criteria,
      ),
    ).not.toThrow();
  });

  it("requires a complete non-duplicated explanation for every runtime failure", () => {
    const preflight = {
      blockers: [],
      checks: [],
      failures: [
        {
          id: "baseline-1",
          scenario: "baseline",
          file: "test.tsx",
          name: "AC-1",
          status: "failed",
          message: "Expected 299 received 75",
        },
      ],
    };
    const valid = {
      id: "baseline-1",
      classification: "expected-feature-failure" as const,
      evidence: "Issue changes the threshold from 75 to 299; baseline is 75.",
    };
    expect(validateRuntimeReview(preflight, [valid])).toEqual([]);
    for (const assessments of [
      [],
      [valid, valid],
      [{ ...valid, evidence: "" }],
      [{ ...valid, classification: "test-defect" as const }],
      [valid, { ...valid, id: "unknown" }],
    ])
      expect(
        validateRuntimeReview(preflight, assessments).length,
      ).toBeGreaterThan(0);
  });
});
