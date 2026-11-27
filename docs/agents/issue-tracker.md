# Issue tracker

Tickets and specs live in GitHub Issues in `mavix21/orchid-pay`. Use `gh` with an explicit `--repo mavix21/orchid-pay` target for issue and PR commands.

Before publishing, verify the repository with `gh repo view mavix21/orchid-pay --json nameWithOwner`. Read the relevant issue body and comments before implementation. Publish a spec as an issue; connect implementation tickets as sub-issues and use native blocking dependencies when supported by the installed CLI. Otherwise use `Part of #N` and `Blocked by: #N` references in issue bodies.

Use a temporary file outside the repository and `--body-file` for multiline bodies. Keep research and planning on the issue; put implementation results in the PR. Close a ticket only after its acceptance criteria are satisfied.

**PRs as a request surface: no.**
