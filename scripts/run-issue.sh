#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
issue_number="${1:?Usage: bash scripts/run-issue.sh ISSUE_NUMBER}"
[[ "$issue_number" =~ ^[0-9]+$ ]] || { echo 'Numeric issue number required' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Issue runner requires a clean committed checkout' >&2; exit 1; }
export HARNESS_MODE="${HARNESS_MODE:-offline}"
case "$HARNESS_MODE" in
  offline) ;;
  openai)
    [[ -n "${OPENAI_API_KEY:-}" && -n "${OPENAI_MODEL:-}" ]] || {
      echo 'OpenAI mode requires OPENAI_API_KEY and OPENAI_MODEL.' >&2
      exit 1
    }
    ;;
  *) echo 'HARNESS_MODE must be offline or openai.' >&2; exit 1 ;;
esac
printf 'Harness mode: %s\n' "$HARNESS_MODE"
harness() { node --import tsx src/harness/cli.ts "$@"; }
harness doctor
harness lease-probe
intake="$(harness intake-issue "$issue_number" --approve-write)"
work_id="$(printf '%s' "$intake" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>console.log(JSON.parse(s).workId))')"
printf '%s\n' "$work_id" > work/latest-issue-work-id.txt
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then printf 'work_id=%s\n' "$work_id" >> "$GITHUB_OUTPUT"; fi
harness audit-start "$work_id" --approve-write
harness triager "$work_id" --approve-write
harness fitter --work "$work_id" --paths src/components/CartDrawer.tsx,src/components/ShippingProgress.tsx,src/__tests__/shipping.test.tsx --approve-write --approve-cost
harness developer "$work_id" --approve-write
if ! harness tester "$work_id" --approve-write; then harness fixer "$work_id" --approve-write; fi
harness git "$work_id" --approve-write
harness evidence --work "$work_id" --output docs/product-008/evidence.json --approve-write
harness acceptance-status docs/product-008/evidence.json
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then cat "work/$work_id/pr-summary.md" >> "$GITHUB_STEP_SUMMARY"; fi
