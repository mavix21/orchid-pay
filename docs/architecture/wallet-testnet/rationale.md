# Rationale: wallet server on devnet

Platform constraints are in [ground.md](ground.md).

## Problem

A person with no crypto must open a wallet under a username, hold USDC, and pay another username or an external address. A payment happens once or provably not at all, even when the network drops or the caller disappears mid-send.

## Shape

The ledger is the truth for balances and for whether a payment happened. Postgres holds what the ledger cannot: which username owns which address, and which signed transaction belongs to which intent.

1. The server drafts every transaction and accepts back only a signature: `Approval` has no envelope field.
2. One transfer id maps to one signed transaction, stored before it is first submitted.
3. One sender has at most one signed, unfinished transfer, enforced by a partial unique index.
4. A final state is written only from ledger evidence. `submit` returns `void`, and `conclude` rejects `Undecided`.
5. `open` and `transfer` are replayable: retry, resume and status are the same call.

## Synthesis decision

**Base: a server ledger.** The server stores and finishes every transfer, so a payment completes after the caller is gone. Settlement and balances are read from the chain. Solana types are private to `solana/`, which implements the `Chain` service. Elsewhere in `src/`, only `binding/` imports from it, and selects the chain's address rules, assets, draft timing, device and record networks, `Chain` layer and payout sandbox.

**Rejected:** a device outbox, where the phone builds and submits and the server only co-signs, because transaction rules would live twice. A staged `prepare`/`submit`/`status` API, because the caller would own the order of three calls for one operation.

**Package boundary.** `exports` has two entries, `"."` and `"./server"`, and every server file is named `*.server.ts`. The root build runs production builds that must reject a server, relative and private import from client code, and one client transport build that must pass. Add no `paths` alias for this package.

## Tradeoffs accepted

- One in-flight payment per sender, in exchange for a no-double-send rule that is trivially true.
- Up to two minutes of pending for a payment that never reaches the network, in exchange for never guessing an outcome.
- The server could misdirect a payment by lying about a username, in exchange for usernames at all. It cannot change the amount.
- Every opened wallet keeps the rent of its sponsored USDC account locked for good. Orchid never closes a wallet to take it back, so an address or username someone was given keeps receiving. The Turnstile check on creation and the rate limits are the only bound on what sign-ups cost the sponsor.

## Decisions

- **Usernames.** `[a-z0-9_]`, 3-20 characters, lowercase and permanent, bound when the wallet is created, in the same transaction that consumes the single-use enrollment challenge and stores the backup, so a creation either binds the name and stores the backup or does neither. The challenge is issued only after the server validates a Cloudflare Turnstile token with Siteverify, so a binding needs a passing check; retrying a creation whose name is already bound to the address needs no new token, and nothing from the check is stored. A name resolves as a recipient only while its wallet is `active`. Restore returns only the name bound to the restored address. Names containing `orchid` and reserved words cannot be bound.
- **Registration.** Open, with no invite or quota.
- **Opening at creation.** The second passkey prompt of creation signs the wallet's opening with its backup, so a new wallet shows its deposit address with no further prompt. The server settles a sealed opening itself, of a new wallet or a recovered one: sealing it queues the work, and the sweep picks up what the queue left unfinished. Either activates the wallet once its account is open on the network, resubmits the transaction while it can still settle, and otherwise clears the attempt without drafting another. A wallet whose opening failed or expired opens again from the home or receive screen. An account already on the network activates without a signature only when its username is already bound to it; otherwise its key signs an opening first.
- **Schema location.** Tables and migrations live in `packages/wallet`; `packages/db` is the driver.
- **External memos.** External sends accept an optional text or ID memo. Orchid sends carry none.
- **Unauthenticated reads.** `overview` takes an address without authentication on devnet.
- **Network reset.** Tables survive a reset; missing wallets are marked recovered and reopen under the same username, and transfers are scoped to the new epoch.
- **Sponsor.** One sponsor key, `SPONSOR_SECRET`, pays every fee and the rent of each wallet's USDC account, and is the close authority an opening sets on it.
- **Payouts.** A payout is an external link claim to the payout partner's deposit address whose stored order also carries the payout destination and the quoted local amount, so drafts, settlement and the sweep are the external claim's. The server only accepts a claim to the partner's address at the partner's current quote in the destination's local currency, and answers the payout's status from the claim's ledger time and the partner. `PAYOUT_PARTNER` in `wrangler.jsonc` selects the partner; `sandbox` is the only one: its deposit address derives from the sponsor's key and holds a USDC account the sponsor opens with `devnet:open-partner`, it quotes 3.75 soles, 4,000 Colombian pesos, 5.40 reais or 18.50 Mexican pesos per USDC, and it completes a payout eight seconds after its claim settles without paying anyone.
