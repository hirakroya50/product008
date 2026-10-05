import type { Issue } from "./common";
export interface ShippingRequest {
  kind: "banner" | "threshold";
  threshold: number;
}
export function shippingRequest(
  issue: Pick<Issue, "title" | "body">,
): ShippingRequest | null {
  const text = `${issue.title} ${issue.body}`;
  if (
    !/free shipping.*(?:banner|progress|threshold)|shipping progress/i.test(
      text,
    )
  )
    return null;
  const match =
    text.match(/threshold\s*(?:to|of|at|:|=)?\s*\$?(\d+(?:\.\d{1,2})?)(?![\d.])/i) ??
    text.match(/\$(\d+(?:\.\d{1,2})?)(?![\d.])\s+(?:free\s+shipping\s+)?threshold/i);
  if (/threshold/i.test(text) && !match) return null;
  const threshold = match ? Number(match[1]) : 75;
  if (!Number.isFinite(threshold) || threshold < 10 || threshold > 1000)
    return null;
  return { kind: match ? "threshold" : "banner", threshold };
}
