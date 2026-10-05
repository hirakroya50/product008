// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { MemoryLease, leaseProbe, withLease } from "../harness/lease";
import { normalize } from "../harness/intake";
import { safePath, approve, getOption } from "../harness/common";
describe("pipeline boundaries", () => {
  it("denies collisions and non-owner operations", async () => {
    const l = new MemoryLease();
    expect(l.acquire("x", "a")).toBe(true);
    expect(l.acquire("x", "b")).toBe(false);
    expect(l.renew("x", "b")).toBe(false);
    expect(l.release("x", "b")).toBe(false);
    expect(l.renew("x", "a")).toBe(true);
    expect(l.release("x", "a")).toBe(true);
    expect((await leaseProbe()).status).toBe("passed");
  });
  it("rejects expired renewal and allows new owner", () => {
    vi.useFakeTimers();
    try {
      const l = new MemoryLease();
      l.acquire("x", "a", 10);
      vi.advanceTimersByTime(11);
      expect(l.renew("x", "a")).toBe(false);
      expect(l.acquire("x", "b")).toBe(true);
      expect(l.release("x", "a")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it("normalizes GitHub labels and rejects invalid payloads", () => {
    const i = normalize({
      title: " Shipping ",
      body: "Details",
      number: 8,
      labels: [{ name: "cart" }],
    });
    expect(i.issueId).toBe("8");
    expect(i.labels).toEqual(["cart"]);
    expect(() => normalize({ title: "", body: "bad" })).toThrow();
    expect(() =>
      normalize({ title: "valid", body: "text", issueId: "../escape" }),
    ).toThrow();
  });
  it("denies traversal and infrastructure edits", () => {
    expect(() => safePath("src/components/../../harness/cli.ts")).toThrow();
    expect(() => safePath(".env")).toThrow();
    expect(() => safePath("package.json")).toThrow();
  });
  it("requires write and cost approval", () => {
    expect(() => approve([])).toThrow();
    expect(() => approve(["--approve-write"], true)).toThrow();
    expect(() =>
      approve(["--approve-write", "--approve-cost"], true),
    ).not.toThrow();
  });
});

describe("CLI options", () => {
  it("uses defaults for absent flags and rejects missing values", () => {
    expect(getOption(["--work", "work-1"], "--output")).toBeUndefined();
    expect(getOption(["--output", "evidence.json"], "--output")).toBe(
      "evidence.json",
    );
    expect(() =>
      getOption(["--paths", "--approve-write"], "--paths"),
    ).toThrow();
  });
});
