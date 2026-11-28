# Orchid

**Dollars that move by link.**

Orchid is a self-custodial dollar account for Latin America, starting in Peru. Send dollars as a link in WhatsApp, or ask to be paid with one, and the person on the other side needs nothing: no app, no wallet and no KYC to start. They take the money however they want: soles in Yape, any wallet or exchange, or their own Orchid account in one tap. Your keys never leave your phone, and Orchid never holds your money.

## One link, straight to Yape

> Rosa works in Madrid. She opens Orchid, types 50, taps **Crear link de pago** and sends it to her mother in Arequipa on WhatsApp.
>
> Her mother taps the link, enters her phone number, sees "Recibirás S/ 187.40" and taps **Recibir en Yape**. Seconds later, the soles are in her Yape. Or she keeps the dollars in an Orchid account of her own, protected by her fingerprint.
>
> No app to install, no crypto to understand. Until the link is claimed, the money is held by the network for the link, never by Orchid.

## Why Orchid

- **Every link brings someone new.** Whoever receives a payment link can keep the dollars in an account of their own, created in one step with a passkey, with no phrase to write down and no fees to pay. Every payment grows Orchid.
- **Get paid with a link.** Ask for an amount, share the link, and anyone can pay it, with or without Orchid. You see it paid in your activity.
- **Your money, your keys.** A standard recovery phrase stays on your device, sealed at rest by a passkey (Face ID or fingerprint) that every payment asks for again. The passkey proves it's you but never shows the payment, so Orchid's review screen is what tells you what you sign, and while you approve, the phrase sits in the app's memory, where code running on your phone could read it and the browser cannot promise to wipe it. Export it anytime and open the same wallet in other apps. When an exchange is hacked, its customers lose their money; nobody can empty an Orchid account without its owner.
- **Nothing to learn.** No gas, no networks, no trustlines. Orchid sponsors every account and pays every network fee.
- **Money that doesn't get lost.** Orchid checks every destination before you sign: exchanges that need a memo, accounts that can't receive yet, deposit addresses on the wrong network. The sender can take back a link nobody claimed. Every payment has a status you can follow, in plain Spanish or English, and a link opens in its sender's language until the recipient picks their own.

## How it works

| Layer                                     | What Orchid does                                                                                                                                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Payment links**                         | The link carries a code after the `#` that the server never receives. The device derives the link's key from it; only that key can claim the funds the network holds, and the sender can take them back anytime.       |
| **Payment requests**                      | A public link with who is asking, how much and why. It holds no secret, so any way to pay can settle it: Orchid today, other wallets later.                                                                            |
| **The phone approves everything**         | Orchid's server drafts each transaction; the phone checks that it does exactly what the user asked (recipient, asset, amount, memo), shows it, and signs only after a fresh passkey check.                             |
| **Payments behind one seam**              | The wallet domain talks to the network through one interface. Stellar is the first implementation: usernames, USDC payments in seconds, sponsored accounts and fee bumps. Other networks plug in behind the same seam. |
| **Local money through licensed partners** | A licensed payment partner turns USDC into soles and pays out to Yape, Plin and banks over Peru's interoperable payment network. Until one is signed, testnet payouts go through a clearly marked simulation.          |

## Business model

Sending, receiving and asking to be paid are free; that is how Orchid spreads. Revenue comes from what people do with their dollars:

- **Cash-out to Yape, Plin and banks:** a small spread over the partner's rate.
- **Later, savings and investing:** a share of yield earned and a small fee per trade.

## Roadmap

| Stage                       | Features                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Live on Stellar testnet** | Permanent usernames, sponsored accounts, passkey backup and restore, USDC payments with exchange memos checked against the ledger, payment links, activity, deposits from outside Orchid, Spanish and English throughout |
| **Next**                    | Payment requests, keeping a received link in your own account as the main path, simulated Yape payouts                                                                                                                   |
| **Then**                    | Payouts to Yape and Plin through a licensed partner, payment requests paid from other wallets, savings, swaps and tokenized stocks                                                                                       |

## Built with

Stellar (classic accounts, sponsored reserves, fee bumps, claimable balances), Circle USDC, passkeys (WebAuthn PRF), Cloudflare Workers and Hyperdrive, Neon Postgres, TanStack Start, React, Effect, Drizzle, Bun, Tailwind CSS, shadcn, Base UI.

## Run it locally

Install Bun, Node 22.12 or newer and Docker Desktop, then run:

```sh
bun run setup
bun run dev
```

Open http://localhost:3000.

`bun run setup` is safe to repeat. It installs dependencies, creates or starts the `orchid-postgres` container on port 55432, applies the migrations and fills the gitignored `apps/web/.dev.vars`. Add `--e2e` (`bun run setup --e2e`) to also install Playwright's Chromium.

Creating an account opens it on Solana devnet, which needs one funded sponsor: it pays every fee and the rent of each wallet's USDC account. Setup creates it, writes its keypair to `.dev.vars` as the base58 `SPONSOR_SECRET`, printing only its address, and airdrops it devnet SOL while it has none. The sponsor then opens the USDC account of the sandbox payout partner derived from its key. Devnet RPCs often refuse airdrops; setup then still finishes, skips the payout partner and asks you to fund the printed address at https://faucet.solana.com and run setup again. The dev server needs `SOLANA_RPC_URL` from a provider such as Helius, since the public devnet RPC refuses its requests. Setup takes it from the `SOLANA_RPC_URL` environment variable or asks for it; left empty, it writes the key empty and warns until you fill it in. Setup also writes a random `SESSION_SECRET` and Cloudflare's documented Turnstile test pair, `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Keys already in `.dev.vars` are kept. In a worktree, setup links the main checkout's `.dev.vars` instead of creating a new sponsor.

A deploy with a new sponsor needs the sandbox payout partner opened once: `SPONSOR_SECRET=… SOLANA_RPC_URL=… bun run --cwd packages/wallet devnet:open-partner`. Deploys read `SOLANA_RPC_URL`, `SPONSOR_SECRET`, `TURNSTILE_SECRET_KEY` and `SESSION_SECRET` as Worker secrets (`wrangler secret put`), since the Helius URL carries an API key. `PASSKEY_ORIGINS` (the comma-separated origins whose passkeys the server accepts) and `TURNSTILE_SITE_KEY` are set in `apps/web/wrangler.jsonc`.

`bun run --cwd apps/web test:e2e` builds the app, serves it with `vite preview`, and creates and restores wallets in Chromium with a virtual passkey (`bun run setup --e2e` once). It needs Docker, `surfpool` and the built `orchid-links` program (`anchor build --no-idl --ignore-keys`): the preview server starts a local Surfnet on port 18899 with the program and the USDC mint, funds a fixed local sponsor and passes it and the Surfnet URL only to the `vite preview` process. It never touches the database above: it starts a throwaway `orchid-e2e-database` container on port 55434, applies the migrations, points the preview server at it, and removes it when the run ends. Restart the development database with `docker start orchid-postgres`.

Wrangler config supplies `nodejs_compat` and the local Docker connection string. `bun run dev` uses Docker even when Neon credentials exist in the root `.env.local`. Override the local connection string if needed:

```sh
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE='postgres://orchid:orchid-local@127.0.0.1:55432/orchid'
bun run dev
```

Local Hyperdrive connects directly to Postgres without production pooling or caching. The configured Hyperdrive ID is used for the deployed Worker.

To develop against Neon, `bunx neon checkout dev` selects the database branch and pulls its credentials into the gitignored root `.env.local`. `bun run db:migrate` applies wallet migrations through `DATABASE_URL_UNPOOLED`. `bun run --cwd apps/web dev:neon` uses that URL for its local Hyperdrive connection; an explicit `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` takes precedence.

`programs/orchid-links` is the Anchor program that holds a payment link's unclaimed funds on Solana, and `packages/orchid-links` is its hand-written `@solana/kit` client. `bun run --cwd packages/orchid-links test` builds the program with `anchor build` (Anchor 1.2.2 and the Solana CLI) and runs its LiteSVM suite against the real SPL Token program. The program's deploy keypair is the gitignored `target/deploy/orchid_links-keypair.json`; its address is pinned in `Anchor.toml`, the program's `declare_id!` and the client.

`packages/db` exports `Database` and `databaseLayer`; the web server builds the layer from `env.HYPERDRIVE` inside each request. Wallet tables and their Drizzle migrations live in `packages/wallet`; see the [wallet README](packages/wallet/README.md) for its behaviour, tests and the Hyperdrive caching prerequisite for deployment. The design rationale is in [docs/architecture/wallet-testnet](docs/architecture/wallet-testnet/rationale.md).

## Team

Marcelo Vizcarra · https://mavix.dev

## License

[Apache License 2.0](LICENSE)
