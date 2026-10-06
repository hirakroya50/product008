import fs from "node:fs";
import { ask, harnessMode, objectSchema, stringSchema } from "../ai";
import { repositoryContext, sourcesFor } from "../repository";
import { format } from "prettier";
import { fingerprint } from "../common";
import type { TestRecord } from "./tester";
import { qualityHash } from "../quality";
import { read, write, safePath, hash, type Draft } from "../common";
import { shippingRequest } from "../shipping-request";
export const shippingComponent = `export const FREE_SHIPPING_THRESHOLD = 75;
export function shippingProgress(total: number) { return Math.max(0, Math.min(100, total / FREE_SHIPPING_THRESHOLD * 100)); }
export function ShippingProgress({subtotal}: {subtotal:number}) {const remaining=Math.max(0,FREE_SHIPPING_THRESHOLD-subtotal);return <section className="shipping-banner" aria-label="Free shipping progress"><p role="status">{remaining>0?\`You're $\${remaining.toFixed(2)} away from free shipping.\`:'You unlocked free shipping!'}</p><progress aria-label="Shipping progress" value={shippingProgress(subtotal)} max={100}/></section>; }
`;
export function shippingTestFor(threshold: number) {
  return `import {describe,it,expect} from 'vitest'; import {render,screen} from '@testing-library/react'; import {ShippingProgress,shippingProgress,FREE_SHIPPING_THRESHOLD} from '../components/ShippingProgress'; import {CartDrawer} from '../components/CartDrawer'; import {products} from '../data/products';
describe('free shipping',()=>{it('uses the requested threshold',()=>{expect(FREE_SHIPPING_THRESHOLD).toBe(${threshold});});it.each([[0,0],[FREE_SHIPPING_THRESHOLD/2,50],[FREE_SHIPPING_THRESHOLD,100],[FREE_SHIPPING_THRESHOLD+25,100],[-10,0]])('clamps subtotal %s to progress %s',(total,expected)=>{expect(shippingProgress(total)).toBe(expected);});it('shows remaining dollars',()=>{render(<ShippingProgress subtotal={FREE_SHIPPING_THRESHOLD/2}/>);expect(screen.getByRole('status')).toHaveTextContent('$'+(FREE_SHIPPING_THRESHOLD/2).toFixed(2)+' away');});it('qualifies exactly at threshold',()=>{render(<ShippingProgress subtotal={FREE_SHIPPING_THRESHOLD}/>);expect(screen.getByRole('status')).toHaveTextContent('You unlocked free shipping');});it('integrates with actual cart subtotal',()=>{render(<CartDrawer items={[{product:products[0],size:'M',color:products[0].colors[0],quantity:2}]} onClose={()=>{}} onQuantity={()=>{}}/>);const remaining=FREE_SHIPPING_THRESHOLD-products[0].price*2;expect(screen.getByRole('status')).toHaveTextContent(remaining>0?'$'+remaining.toFixed(2)+' away':'You unlocked free shipping');});});
`;
}
export const shippingTest = shippingTestFor(75);
export function mockPatch(original?: string, threshold = 75) {
  const cart =
    original ??
    fs.readFileSync(safePath("src/components/CartDrawer.tsx"), "utf8");
  return {
    "src/components/ShippingProgress.tsx": shippingComponent.replace(
      "= 75;",
      `= ${threshold};`,
    ),
    "src/__tests__/shipping.test.tsx": shippingTestFor(threshold),
    "src/components/CartDrawer.tsx": cart
      .replace(
        "// SHIPPING_IMPORT",
        "import { ShippingProgress } from './ShippingProgress';",
      )
      .replace(
        "{/* SHIPPING_BANNER */}",
        "<ShippingProgress subtotal={total}/>",
      ),
  };
}
export async function developer(id: string, repair = false) {
  const draft = read<Draft>(id, "draft.json");
  if (!repair)
    for (const p of draft.paths)
      if (hash(safePath(p)) !== draft.hashes[p])
        throw new Error(`Stale draft: ${p}`);
  if (
    draft.qualityVersion !== 2 ||
    draft.acceptanceHash !== qualityHash(id, "acceptance-tests.json")
  )
    throw new Error("Missing or changed acceptance contract; refit required");
  if (repair) {
    const failed = read<TestRecord>(id, "test-record.json");
    if (
      failed.draftHash !== qualityHash(id, "draft.json") ||
      failed.acceptanceHash !== draft.acceptanceHash ||
      failed.fingerprint !== fingerprint()
    )
      throw new Error("Stale failure evidence; rerun testing before repair");
    if (
      !Number.isInteger(failed.cycle) ||
      failed.cycle < 0 ||
      failed.cycle >= draft.maxCycles ||
      draft.maxCycles !== 3
    )
      throw new Error("Repair cycle budget exceeded");
  }
  const mode = harnessMode();
  if (mode !== draft.mode) throw new Error("Mode changed after fitting");
  if (!repair)
    for (const [p, expected] of Object.entries(draft.contextHashes)) {
      if (hash(safePath(p)) !== expected)
        throw new Error(`Stale repository context: ${p}`);
    }
  let patch: Record<string, string>;
  if (mode === "openai") {
    if (!draft.approvedCost)
      throw new Error("API execution requires cost approval");
    patch = await ask<Record<string, string>>(
      id,
      "developer",
      "Implement the complete fitted plan like a senior engineer. Return complete contents for every planned path, preserving unchanged content where no edit is needed. Follow repository conventions, use clear names, robust edge/error handling and accessible UI. Add meaningful regression tests and retain unrelated test assertions. No stubs, TODO implementations, type suppressions, skipped tests or invented verification claims. Do not change files solely to increase the diff. During repair address the actual failed checks and independent review findings, preserving working behavior. The acceptance tests are immutable. If a requirement cannot be implemented within scope, do not fake success: leave code for review to reject.",
      {
        draft,
        repository: repositoryContext(),
        sources: sourcesFor(draft.paths),
        originalSources: repair ? read(id, "source-backup.json") : undefined,
        acceptance: read(id, "acceptance-tests.json"),
        failures: repair
          ? read<TestRecord>(id, "test-record.json")
              .checks.filter((check) => check.status !== "passed")
              .map((check) => ({
                name: check.name,
                status: check.status,
                report: check.report,
                failures: check.failures?.map((failure) => ({
                  ...failure,
                  message: failure.message.slice(0, 6000),
                })),
                log: check.failures?.length
                  ? undefined
                  : check.log.slice(0, 8000),
              }))
          : undefined,
      },
      objectSchema(
        Object.fromEntries(draft.paths.map((p) => [p, stringSchema])),
      ),
    );
  } else {
    const request = shippingRequest(draft.issue);
    if (!request) throw new Error("Unsupported offline shipping request");
    patch = mockPatch(
      repair
        ? read<Record<string, string>>(id, "source-backup.json")[
            "src/components/CartDrawer.tsx"
          ]
        : undefined,
      request.threshold,
    );
  }
  if (
    !patch ||
    typeof patch !== "object" ||
    Array.isArray(patch) ||
    Object.keys(patch).length !== draft.paths.length ||
    Object.keys(patch).some(
      (p) =>
        !draft.paths.includes(p) ||
        typeof patch[p] !== "string" ||
        !patch[p].trim() ||
        patch[p].length > 100000,
    )
  )
    throw new Error("Patch exceeds plan");
  // Validate and format every changed file before performing any writes.
  for (const p of draft.paths) {
    const current = sourcesFor([p])[p];
    if (patch[p] !== current)
      patch[p] = await format(patch[p], { filepath: p });
  }
  if (!repair) write(id, "source-backup.json", sourcesFor(draft.paths));
  const before = Object.fromEntries(
    draft.paths.map((p) => [p, hash(safePath(p))]),
  );
  for (const p of draft.paths) {
    fs.mkdirSync(safePath(p).slice(0, safePath(p).lastIndexOf("/")), {
      recursive: true,
    });
    fs.writeFileSync(safePath(p), patch[p]);
  }
  const record = write(id, repair ? "fix-record.json" : "patch-record.json", {
    mode,
    repair,
    changedFiles: draft.paths.filter((p) => before[p] !== hash(safePath(p))),
    hashes: Object.fromEntries(draft.paths.map((p) => [p, hash(safePath(p))])),
    applied: true,
  });
  const cycle = repair
    ? read<{ cycle: number }>(id, "test-record.json").cycle + 1
    : 0;
  write(id, `patch-cycle-${cycle}.json`, record);
  return record;
}
