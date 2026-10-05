// @vitest-environment node
import { describe, expect, it } from "vitest";
import { shippingRequest } from "../harness/shipping-request";
import { mockPatch } from "../harness/workers/developer";

describe("offline issue routing", () => {
  it("supports the original banner issue", () => {
    expect(
      shippingRequest({
        title: "Add free shipping progress banner to CartDrawer",
        body: "",
      }),
    ).toEqual({ kind: "banner", threshold: 75 });
  });
  it.each([100, 125, 99.5, 10, 1000])(
    "supports a bounded $%s threshold",
    (threshold) => {
      expect(
        shippingRequest({
          title: `Change the free shipping threshold to $${threshold}`,
          body: "Keep cart behavior.",
        }),
      ).toEqual({ kind: "threshold", threshold });
    },
  );
  it.each([
    "Change free shipping threshold",
    "Change free shipping threshold to $1",
    "Change free shipping threshold to $1001",
    "Add payments integration",
  ])("stops unsupported request: %s", (title) => {
    expect(shippingRequest({ title, body: "" })).toBeNull();
  });
  it("generates the requested constant and a matching regression test", () => {
    const patch = mockPatch("// SHIPPING_IMPORT\n{/* SHIPPING_BANNER */}", 100);
    expect(patch["src/components/ShippingProgress.tsx"]).toContain(
      "FREE_SHIPPING_THRESHOLD = 100",
    );
    expect(patch["src/__tests__/shipping.test.tsx"]).toContain("toBe(100)");
    expect(patch["src/components/CartDrawer.tsx"]).toContain(
      "<ShippingProgress subtotal={total}/>",
    );
  });
});

it("parses the original sample issue body", () => {
 expect(shippingRequest({title:"Add free shipping progress banner to CartDrawer",body:"Show remaining dollars until the $75 free shipping threshold."})?.threshold).toBe(75);
});
