---
name: cross-review
description: "Cross-family code review loop via T3 Code delegation against Standards, Spec, and test discipline until approved or stuck. Use as the review step after implementation, or when the user asks for a cross-review of a branch or PR."
---

# Cross-Review

Iterative review loop inside the implementing thread using one read-only reviewer from a different model family. Holds the diff to the smallest correct change while fighting scope creep.

## Budget and stop rules

- **Default:** 3 rounds. Round 1 is a full review; later rounds inspect only changed code and open findings.
- **Extended (5 rounds):** allowed only when the change touches security, key custody, signing, sponsorship/fees, concurrency, or data loss AND a `blocker` or `should` stays open with evidence.
- **Early exit:** a round returning only `nit` findings ends the loop. Declined nits and format-only or doc-only edits need no new round.
- **Approved:** `VERDICT: APPROVE` (or a nit-only round) on the current diff, zero open `blocker` or `should` findings, and covering checks pass.
- **Stuck:** any finding stays disputed after two replies, or the round budget ends with an open `blocker` or `should`. Budget exhaustion is never approval.
- **Ledger:** track every finding across rounds with `id`, `severity`, `disposition` (`fixed` | `disagree` | `declined`), and evidence.

## 1. Scope

Confirm `git status --short` has no unrelated edits; stop and ask if unrelated changes are mixed in. Commit scoped changes on the feature branch before round 1 so `HEAD` matches the diff under review.

Pin the base SHA after `git fetch origin`:

- PR branch: base ref from `pull_request_read`, then `git merge-base HEAD origin/<base>`.
- Local branch: `git merge-base HEAD origin/main` (or a user-named base when no remote exists).

Confirm `git diff <base>...HEAD` is non-empty and keep that exact diff command across every round.

Gather before round 1:

- **Intent & out-of-scope:** 1–2 sentences stating what this change must do and what stays out of scope.
- **Spec:** resolve the originating ticket/spec using the order in `.agents/skills/code-review/SKILL.md` (Step 2). State `no spec available` if none exists.
- **Standards:** `AGENTS.md`, `CODING_STANDARDS.md`, `.agents/skills/code-review/SKILL.md` (Standards/Spec axes and Fowler smell baseline), plus any other repo standards files.
- **Checks:** run covering checks (`bun lint`, `bun run typecheck`, targeted/full tests, `bun run build` as applicable). Fix anything this change breaks before sending; note unavailable or pre-failing checks in the brief.
- **Line delta:** compute `git diff --numstat <base>...HEAD`, split into test files (`*.test.*`, `*.spec.*`, `e2e/**`, `test/**`, `__tests__/**`) vs non-test files, as `+<T>/-<T> test lines vs +<C>/-<C> code lines`.

**Done when:** base SHA, diff command, spec pointer, passing check results, and test-vs-code line delta are recorded.

## 2. Select and start the reviewer

Call `orchestrator_capabilities` once to read `inheritedModel`, `inheritedProviderInstanceId`, and the live provider catalog. Treat `orchestrator_capabilities` as the source of truth for model IDs and options.

Select one reviewer from a **different model family** on a provider with `canRunChildTask: true` and `canRunCrossProviderChildTask: true`:

1. **User-specified:** if the user requested a specific cross-family model or provider, resolve it from the catalog.
2. **Default cross-family pair:** pick the top frontier model listed on an enabled native provider from another family — typically `codex` (OpenAI) when the implementer is Gemini or Claude, and `antigravity` (Gemini) when the implementer is OpenAI/Codex, or another enabled frontier family (such as `claudeAgent`) if the preferred one is unavailable. Prefer native first-party providers (`codex`, `antigravity`, `claudeAgent`) over multi-provider aggregators (`cursor`).
3. **Reasoning option:** set the model's reasoning/thinking option exposed in the catalog (e.g., `reasoningEffort`, `thought_level`, or `effort`) to `"high"` when supported.
4. **Blocker:** if T3 delegation tools are absent or no enabled provider from a different model family is available, report the blocker and stop rather than reviewing within the same family.

Keep the same reviewer across every round unless the user asks to switch.

Start the reviewer with `delegate_task` (`role: "review"`, `mode: "async"`, fresh `clientRequestId` per round) and save `taskId`. Wait for the completion notice and leave all scoped files untouched while the review runs.

Treat a timeout, error, or empty reply as a failed round, never as approval: call `task_cancel`, verify stop, and restart the round with the ledger and a new `clientRequestId`.

### Round 1 brief

Delegated reviewers receive no parent history; pass every field below:

```text
Read-only review. Inspect and reply only: make no edits, commits, pushes, PR comments, or subagents.
Repo: <abs path>
Base: <base sha>
Diff: git diff <base>...HEAD (commits: git log <base>..HEAD --oneline)
Intent: <1-2 sentences>
Out of scope: <explicit boundaries>
Spec: <issue key/URL, path, or "no spec available">
Standards: read AGENTS.md, CODING_STANDARDS.md (especially Testing), and .agents/skills/code-review/SKILL.md (Standards/Spec axes and Fowler smell baseline; repo standards override smells; skip tooling-enforced checks).
Checks: <commands run and results>
Line delta: <+T/-T test lines vs +C/-C code lines>

Review along two separate axes:
1. Standards (including code smells and test discipline).
   Test discipline is first-class: flag as `should` any added or edited test that violates the Testing policy (duplicate cases, input variations that belong in one named parameterized case or should be dropped, expectations that restate constants or mirror mocks, cases with no distinct observable behavior change that would fail them). Request a new test only when you name a concrete behavior change that no existing case catches.
2. Spec: missing/partial requirements, wrong behavior, or unrequested scope creep. Cite spec lines when a spec exists.

Severities:
- blocker: intended behavior wrong, data/security bug, or hard repo standard breach.
- should: real caller-hit bug in scope, spec gap, or Testing policy violation.
- nit: baseline smell judgement call, unrelated path, rare case outside intent, minor perf.

Reply in this exact format:
VERDICT: APPROVE|CHANGES
## Standards
R1-<n> [blocker|should|nit] <file>:<line> <claim>. Fix: <smallest fix>
## Spec
R1-<n> [blocker|should|nit] <file>:<line> <claim>. Fix: <smallest fix>
(Write "None." under an axis with no findings.)
```

**Done when:** the reviewer returns a structured verdict and findings list.

## 3. Answer findings

Verify every finding and its severity yourself against the code, spec, and standards before editing. Treat unrelated paths, rare edge cases outside intent, or tooling-enforced items as `nit` and push back with evidence when over-classified.

- **Agree:** apply the smallest fix; prefer deleting or narrowing over adding helpers, guards, or abstractions. Add a test only when a concrete observable behavior change lacks coverage.
- **Disagree:** reply with concrete evidence (`file:line`, test, or command output). Hold ground rather than agreeing just to end the loop.
- **Nits and out-of-scope:** decline in one line (list as a follow-up if worthwhile). Resist scope creep.

Commit accepted fixes, re-run affected checks (`bun lint` after every change plus covering tests/typecheck), and recompute `git diff --numstat <base>...HEAD`. If review fixes bloated the diff, trim first. Update the ledger for every finding ID.

**Done when:** every finding from the round has a verified ledger disposition (`fixed`, `disagree`, or `declined`), checks pass, and accepted fixes are committed.

## 4. Next round

Start a new round only when budget remains AND at least one holds: a `blocker` or `should` stays open, behavior code changed, or prior approval no longer covers `HEAD`.

Start a fresh `delegate_task` (`role: "review"`, `mode: "async"`, new `clientRequestId`) with the same reviewer. Send:

- All Round 1 context fields (updated checks and updated test-vs-code line delta).
- The full ledger (`R<k>-<n> [severity] fixed|disagree|declined: <evidence/reason>`).
- The same base diff command plus `git diff <prev-round-head>..HEAD`.
- Scope restriction: inspect only changed code and open IDs. Mark every prior ID `resolved` or `still open: <reason>`, and number new findings `R<round>-<n>`.

**Done when:** the loop reaches **Approved**, **Stuck**, or a nit-only exit.

## 5. Stop and ship

Push only once the loop terminates:

- **Approved:** run pre-commit verification (`bun lint`, `bun run typecheck`, `bun run fmt:check`, `bun run build`), push the branch, and open or update the PR.
- **Stuck:** push the branch, keep the PR in draft (or mark it as needing a human decision), and show both sides of each disputed or open item in 2–3 lines for the user to decide.

Put the review summary in the PR description via `pull_request_create` or `pull_request_update` (never as a PR comment), before any trailing attribution:

```markdown
## Cross-family review

- **Reviewer:** `<model>` (`<provider>`, `<effort>`)
- **Rounds:** <N> (<Approved | Stuck — human decision needed>)
- **Verdicts:** R1 <VERDICT>, R2 <VERDICT>
- **Findings:** <F> fixed, <D> declined, <O> open
- **Line delta:** +<T>/-<T> test lines vs +<C>/-<C> code lines
```

Include provider and effort only when verified from `orchestrator_capabilities`. If no PR exists, include the same summary in the final reply.

**Done when:** the branch is pushed, the PR description carries `## Cross-family review`, and any stuck items show both sides concisely for the user.
