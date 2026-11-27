# Coding standards

`AGENTS.md` defines mandatory tooling, validation, type-safety and documentation rules. The configured Oxlint rules and Oxfmt settings are authoritative for mechanically enforced style.

## Domain and boundaries

Use `GLOSSARY.md` terminology. Keep wallet behavior behind the wallet package's public interface; web routes and server functions adapt requests and responses. The root wallet entry is device-safe; server implementation stays behind `@workspace/wallet/server` and `*.server.ts`. Preserve the production boundary checks.

Validate external inputs with the existing Effect schemas and retain branded domain values. Compose wallet effects through the existing service and layer interfaces. Represent expected domain outcomes with the existing tagged result conventions; do not collapse distinct outcomes into generic failures.

Keep private signing keys on the device side. Preserve permanent username binding, replayable orders and ledger-based settlement. A submission acknowledgement or missing RPC history does not prove settlement or failure.

## Change design and verification

Prefer a small public interface that owns complete behavior. Add abstractions for demonstrated needs, and preserve existing package ownership when extending behavior.

## Testing

A test is worth keeping while it catches a behavior change that no other case catches. It costs more than it protects when it repeats a failure another layer already covers, observes how the code works rather than what it does, re-checks a dependency or configuration, or replays a one-off bug that no realistic change would bring back. Whether to add one is the author's judgment. Keep suites small and avoid large test matrices.

Start with the existing case nearest the public boundary. Describe a change to the behavior that must fail it and a change to the implementation that must still pass it. Derive expected results independently from the requirement. Cover each failure at one layer. Delete duplicate cases and production code used only by removed tests.

Prioritize fund safety (key custody and backups, draft and approval matching, replay and concurrent submissions that could pay twice, the sponsorship cap and ledger-based settlement), Effect Schema parsing of external inputs and migration replay against existing data. Wallet database suites run against the test database configured in `packages/wallet/test/test-database.ts`. Domain suites use `wallet-harness.ts` and its in-memory `Chain`, and neither they nor their helpers import a chain adapter under `src/solana/` or `src/stellar/`. Suites that exercise Solana behaviour, including the device reading real drafts, use `solana-harness.ts` and `solana-device-fixtures.ts`; Solana RPC behaviour against a live chain belongs in the Surfpool suites under `packages/wallet/surfpool/`.

| Rule                                                                                                                                                                                                                                  | Enforcing mechanism                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verify distinct behavior at the lowest public boundary. Extend before adding. Mock only external boundaries. Omit smoke runs, trivial logic, static markup, callback wiring and expectations that restate constants or mirror a mock. | Review-only                                                                                                                                            |
| Leave compile-time guarantees to TypeScript. Exercise runtime parsing at external boundaries.                                                                                                                                         | Typecheck in CI and review of boundary cases                                                                                                           |
| For a logic bug, reproduce the failure before fixing it; the reproduction need not stay as a test. For a visual bug, attach before and after screenshots to the PR.                                                                   | Review-only                                                                                                                                            |
| Assert typed outcomes and the error class or `_tag` that the caller handles. Avoid error messages, truthiness, call counts and internal call order.                                                                                   | `orchid/no-error-message-assertion`, restricted Vitest matchers and review                                                                             |
| Use named parameterized cases for distinct inputs. Run all cases and avoid conditional assertions.                                                                                                                                    | `orchid/no-test-in-loop`, `orchid/no-filtered-effect-test`, native Vitest focused, disabled and conditional test rules, and review of Effect callbacks |
| Reserve e2e for browser behavior such as WebAuthn/PRF, IndexedDB persistence and navigation across redirects. Locate actions by role or stable test ID. Assert domain data and outcomes independently of UI wording.                  | Review of layer choice, Playwright locator and matcher rules, `orchid/no-copy-literal-in-e2e`                                                          |
| Wait for the observable browser state. Fix flakes at their source. Avoid forced actions, sleeps, idle-network waits and retries that conceal failures.                                                                                | Playwright action, wait and web-first assertion rules, plus review                                                                                     |
| Preserve the lint constraints themselves.                                                                                                                                                                                             | CI runs Oxlint and its rule fixtures                                                                                                                   |

Use `@effect/vitest` for wallet tests: ordinary `it` for synchronous cases and Effect-returning tests with `yield*` for effectful cases. Share services with scoped test layers; use fresh layers for dependency overrides. Keep database suites serial and on the live clock while wallet code and SQL use wall time; use `TestClock` only for code that reads Effect's clock.
