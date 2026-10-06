# GitHub issue → draft PR demo

## Selecting the developer mode

The default is the deterministic offline demo described below. To use OpenAI, set the repository Actions secret or variable `HARNESS_MODE` to `openai`, add the secret `OPENAI_API_KEY`, and set the secret or variable `OPENAI_MODEL` to your Responses API model ID. Secrets take precedence over variables. The workflow explicitly passes these settings to the runner; your local `.env` is not available on GitHub. Commit and push the workflow and runner changes to the default branch, then start a new run by reopening an issue or using Run workflow. OpenAI calls incur API usage charges; the script records cost approval in the fitter plan.

For local execution, load `.env` with `set -a; source .env; set +a` before running the script. The script respects `HARNESS_MODE`, validates OpenAI configuration, and prints the selected mode. The readiness check validates configuration without making an API call; `patch-record.json` records the mode actually used by Developer. Both modes retain the same bounded shipping issue scope and sandboxed test checks.

Push this workflow and the harness changes to the repository's default branch before creating the test issue. The default branch may be `main` or the currently selected branch; the workflow discovers it automatically. GitHub issue events only run workflows present on the default branch.

1. Rotate the hosted Valkey password if it was shared in chat. In GitHub repository Settings → Secrets and variables → Actions, add a repository secret named `VALKEY_URL` with the complete newly issued `rediss://...` connection URL. Preserve the provider's hostname, credentials and port exactly. Do not commit `.env` or put this URL in an issue.
2. In repository Settings → Actions → General → Workflow permissions, enable **Allow GitHub Actions to create and approve pull requests**. The workflow itself requests only contents write, issues read, and pull requests write. It creates draft PRs and never approves or merges them.
3. Commit and push the new workflow and harness files using your IDE. Confirm the workflow is on the default branch and Actions is enabled.
4. As the repository owner, create an issue titled **Change the free shipping threshold to $100**. Body: **Update the free shipping progress banner in CartDrawer to use a $100 threshold. Keep subtotal and stock behavior intact, clamp progress at 100%, and show unlocked messaging at or above $100.** No label is required.
5. Open Actions → **Product 008 - Issue to draft PR** → the run for the issue. It executes intake → triage → fitter → offline developer → sandboxed checks → bounded fixer if needed → local commit → 15-case audit → branch push → draft PR.
6. Open the draft PR and review the code diff and the run summary. Download the run's artifact to inspect `intake.json`, `diagnosis.json`, `draft.json`, patch/test records, logs, evidence and PR summary. The human gate is your decision to review and merge; no automatic merge is configured.
7. Reopen the issue or use **Run workflow** with an issue number to retry after correcting configuration. If the default branch already contains the requested threshold, the run verifies it and reports that no new PR is required. For a second demo after merging $100, request $125.

This is an offline deterministic implementation demo; no OpenAI key is required. Both banner additions and shipping threshold changes from $10 to $1000 are supported. Unsupported issues stop at triage and leave an audit artifact. Only OWNER/MEMBER/COLLABORATOR-authored issues trigger automatically; manual dispatch requires normal repository access. The workflow uses a GitHub-hosted macOS 15 runner because the existing tester uses the native macOS sandbox. Runner availability and permissions are validated by the first actual hosted run.

For local testing, set `VALKEY_URL` in a local `.env`, load it with `set -a; source .env; set +a`, authenticate `gh auth login`, and run `bash scripts/run-issue.sh NUMBER` from a clean checkout. The local script produces a commit and summary; only the workflow's publication step pushes and creates a remote PR.

Hosted Valkey uses TLS when the URL scheme is `rediss://`; certificate verification stays enabled. With no explicit port, the Redis client uses 6379. If the provider requires another port, use the exact full URL from its dashboard. A connection, auth or TLS failure fails readiness. Credentials are never embedded in workflow source.

See [GitHub issue workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issues) and [Actions PR permissions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository).

The shared Valkey client explicitly sets TLS SNI to the URL hostname for hosted routing, keeps certificate verification enabled, allows 15 seconds for database wake-up, and bounds startup to three attempts. Both doctor and worker leases use this adapter. Connection errors report a sanitized underlying error code instead of only `Connection is closed.` See [Layerbase TLS routing requirements](https://layerbase.com/docs/cloud/connecting/redis).
