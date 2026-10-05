import {
  read,
  write,
  safePath,
  hash,
  type Diagnosis,
  type Draft,
} from "../common";
import { shippingRequest } from "../shipping-request";
export const shippingPaths = [
  "src/components/CartDrawer.tsx",
  "src/components/ShippingProgress.tsx",
  "src/__tests__/shipping.test.tsx",
];
export function fitter(id: string, paths: string[], approvedCost: boolean) {
  const d = read<Diagnosis>(id, "diagnosis.json");
  if (!d.actionable) throw new Error("Issue not actionable");
  if (
    paths.length !== 3 ||
    new Set(paths).size !== 3 ||
    paths.some((p) => !shippingPaths.includes(p))
  )
    throw new Error("Fitter requires exact bounded shipping paths");
  const request = shippingRequest(d.issue);
  if (!request) throw new Error("Unsupported shipping request");
  const draft: Draft = {
    issue: d.issue,
    paths,
    hashes: Object.fromEntries(paths.map((p) => [p, hash(safePath(p))])),
    constraints: [
      "Modify only listed files",
      "No dependency, secret, network, or infrastructure edits",
      "Preserve cart stock and subtotal behavior",
      `Free shipping threshold $${request.threshold}; progress clamped 0..100`,
    ],
    tests: ["typecheck", "build", "test"],
    maxCycles: 3,
    approvedCost,
  };
  return write(id, "draft.json", draft);
}
