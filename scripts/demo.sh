#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export HARNESS_MODE=offline
harness() { pnpm exec tsx src/harness/cli.ts "$@"; }
if [[ -n "$(git status --porcelain)" ]]; then echo 'Demo requires a clean committed workspace.' >&2; exit 1; fi
harness doctor
harness lease-probe
intake="$(harness intake docs/product-008/sample-issue.json --approve-write)"
work_id="$(printf '%s' "$intake" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>console.log(JSON.parse(s).workId))')"
echo "Working on $work_id"
harness audit-start "$work_id" --approve-write
harness triager "$work_id" --approve-write
harness fitter --work "$work_id" --paths src/components/CartDrawer.tsx,src/components/ShippingProgress.tsx,src/__tests__/shipping.test.tsx --approve-write --approve-cost
harness developer "$work_id" --approve-write
if ! harness tester "$work_id" --approve-write; then harness fixer "$work_id" --approve-write; fi
harness git "$work_id" --approve-write
harness evidence --work "$work_id" --output docs/product-008/evidence.json --approve-write
# Evidence records the feature commit. Exclude its own registry from the feature commit
# to avoid a self-referential SHA. The registry is a local audit output, ignored by Git.
harness acceptance-status docs/product-008/evidence.json
echo "Human gate: work/$work_id/pr-summary.md"
