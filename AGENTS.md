# Project rules

Use Bun for package management and scripts.

After every change, run `bun lint` and fix every error in the source before continuing. Before committing, run `bun run typecheck`, `bun run fmt:check`, and `bun run build`; all must pass.

The configured @shadcn/lint and anti-slop rules are mandatory. Fix code rather than bypassing checks: never add oxlint-disable comments, lower severity, edit lint configuration to evade a finding, or add overrides or ignores. Preserve the existing authorized exceptions for generated UI primitives and generated files.

Use official documentation and installed package APIs. Do not introduce any/unknown, type assertions, suppression comments, or library patches to silence errors.

Keep no temporary records in any tracked file (.md, .txt, .json or otherwise): no test results, command outputs, evidence, review rounds, decision logs or dated status notes. Results go in the PR description, decisions in commit messages or the PR.

Docs describe only code that exists. Write no docs for unbuilt designs. Keep docs minimal and update them in place; delete a doc that goes stale instead of growing it. Exception: the product sections of the root `README.md`, everything before "Run it locally", describe the finished product and its roadmap; keep them aligned with the issue tracker rather than with the current code.

Never write code comments, including JSDoc, inline explanations, TODOs, or commented-out code. Convey meaning and functionality through precise names, domain language from `GLOSSARY.md`, and clear code structure. Preserve executable shebangs and machine-required migration separators. Rust sources (`.rs`) are exempt from this rule: comments are allowed there. Generated files (`apps/web/src/routeTree.gen.ts`, `apps/web/worker-configuration.d.ts`) are exempt from this rule and from linting and formatting; keep them exactly as their generators write them.

## Safety

Never open, read or print `spikes/testnet-sponsored-flow/.sponsor.local`, any `.dev.vars` or any other secret, and never commit one.

Use only the Neon `dev` branch; never touch the production database.

Never deploy or change Cloudflare resources; Marcelo deploys.

Never bypass hooks with `--no-verify`, force-push, push to `main` or expose a service through Tailscale Funnel.

## Tests

Extend an existing case at the lowest public boundary that exposes the regression. Add a case only for a distinct observable failure. For logic bugs, reproduce the failure before fixing it. For visual fixes, capture before and after screenshots. Keep copy, static markup, trivial wiring and type guarantees out of tests. Apply the testing table in `CODING_STANDARDS.md` when adding, changing or reviewing coverage.

## Agent skills

### Issue tracker

Use GitHub Issues in `mavix21/orchid-pay` for tickets and specs. Read `docs/agents/issue-tracker.md` before tracker operations.

Work each change on its own branch named `<type>/<name>` after its commit type, such as `feat/send-flow`, cut from `main` before the first change, and end it in a pull request from that branch. Agents never merge.

Keep design references (Figma, Mobbin) out of issue bodies; they are for implementers.

### Triage labels

Use the five canonical roles in `docs/agents/triage-labels.md` when triaging issues.

### Domain docs

Use the single-context `GLOSSARY.md`. Read `docs/agents/domain.md` before domain exploration or terminology changes.

### Coding standards and pull requests

Read `CODING_STANDARDS.md` before implementation or code review. Read `docs/agents/pull-requests.md` before preparing a PR.

Repository rules take precedence over installed skill defaults. Keep research, handoffs, plans, review evidence and decision logs outside tracked files; put durable work requirements in GitHub Issues, results in PR descriptions, and decisions in commits or PRs.
