# Domain docs

Orchid has one wallet domain, described in the root `GLOSSARY.md`. Read it before exploring domain behavior and use its terms in code, tests, issues and PRs. Technical workspace packages do not define separate business contexts.

When a term is missing or ambiguous, compare it with the existing contracts and behavior, then resolve its meaning with the user. Keep glossary entries to domain definitions; implementation details belong beside the code or in existing package documentation.

Read `packages/wallet/README.md` and relevant `docs/architecture/wallet-testnet/` documentation when changing wallet behavior. Check claims against the implementation and surface conflicts. Update documentation in place to describe implemented behavior only.

Record new architectural decisions in commits or PRs, following `AGENTS.md`; the upstream skills' ADR-writing default does not apply here.
