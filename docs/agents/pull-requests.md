# Pull requests

Keep each PR focused on one coherent change and link its originating GitHub issue when one exists. Review against both the issue's acceptance criteria and `CODING_STANDARDS.md`; keep standards findings separate from specification findings. State when no spec is available.

Use the installed `pr` skill and `.github/pull_request_template.md`:

- **Summary:** explain the problem and resulting behavior with the smallest useful diff sketch, tree or diagram.
- **Evidence:** provide concrete before/after behavior and the checks actually run. State unavailable verification explicitly; never invent a baseline or passing result. Keep output and screenshots in the PR, outside tracked files.
- **Merge Danger:** identify reversibility (one-way or two-way door), affected consumers and behavior. For migrations or wallet changes, explain effects on persisted state, pending operations and rollback when applicable.

Before committing, pass every check required by `AGENTS.md`. Resolve review findings before presenting the PR as ready. Creation of a PR does not authorize merging or deploying it.
