// @vitest-environment node
import { describe, expect, it } from "vitest";
import { retryDelay } from "../harness/retry";
function failure(
  status: number,
  hints: Record<string, string> = {},
  code?: string,
) {
  return { status, code, headers: new Headers(hints) };
}
describe("bounded API recovery", () => {
  it("honors Retry-After seconds and dates", () => {
    expect(
      retryDelay(failure(429, { "retry-after": "14.104" }), 0),
    ).toBeGreaterThanOrEqual(14104);
    expect(
      retryDelay(
        failure(503, { "retry-after": new Date(30000).toUTCString() }),
        0,
        10000,
      ),
    ).toBeGreaterThanOrEqual(20000);
  });
  it("honors token reset and millisecond hints", () => {
    expect(
      retryDelay(failure(429, { "x-ratelimit-reset-tokens": "24.3s" }), 0),
    ).toBeGreaterThanOrEqual(24300);
    expect(
      retryDelay(failure(429, { "retry-after-ms": "500" }), 0),
    ).toBeGreaterThanOrEqual(500);
  });
  it("does not retry quota, billing or authentication failures", () => {
    for (const status of [400, 401, 403])
      expect(retryDelay(failure(status), 0)).toBeNull();
    expect(retryDelay(failure(429, {}, "insufficient_quota"), 0)).toBeNull();
    expect(
      retryDelay(failure(429, {}, "billing_hard_limit_reached"), 0),
    ).toBeNull();
  });
  it("does not retry an exhausted-credit response without an error code", () => {
    expect(
      retryDelay(
        {
          status: 429,
          message: "You have no credits remaining. Add credits to continue.",
        },
        0,
      ),
    ).toBeNull();
  });
  it("defers long server hints rather than retrying too early", () => {
    expect(retryDelay(failure(429, { "retry-after": "90" }), 0)).toBeNull();
    expect(
      retryDelay(failure(429, { "x-ratelimit-reset-tokens": "1m5s" }), 0),
    ).toBeNull();
  });
  it("uses bounded exponential backoff when hints are missing or invalid", () => {
    expect(retryDelay(failure(429), 0)).toBeGreaterThanOrEqual(5000);
    expect(
      retryDelay(failure(503, { "retry-after": "invalid" }), 1),
    ).toBeGreaterThanOrEqual(10000);
    expect(retryDelay(failure(500), 5)).toBeLessThanOrEqual(30500);
  });
});
