---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title, then create the ticket's branch as `AGENTS.md` describes before changing anything. If the reference is ambiguous, ask.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Commit your work to the ticket's branch, or to the current branch when there is no ticket.

Once done, call the Skill tool with "cross-review" to review the work before pushing or opening a PR.
