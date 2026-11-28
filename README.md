# Orchid Pay

**Dollars that move by link.**

Orchid Pay is a self-custodial USDC wallet for Latin America, starting in Peru. It runs on Solana devnet for the dev3pack Solana hackathon.

## Send dollars in a message

Rosa in Madrid creates a payment link and shares it with her mother in Arequipa over WhatsApp. Her mother can open the link in her browser and receive the USDC in an Orchid wallet. She can also try a simulated payout to Yape using a Peruvian mobile number. The simulation quotes an amount in soles and shows the payout status. No soles are transferred.

## What you can do on devnet

- **Create and restore a wallet.** Pick a permanent username and use a passkey to protect the encrypted backup of your secret phrase. The device signs wallet transactions. Orchid sponsors transaction fees and funds the rent needed to open the wallet's USDC token account.
- **Send and receive USDC.** Send to an Orchid username or a Solana address, receive deposits from other wallets, and follow payments in Activity. The app supports Spanish and English.
- **Send a payment link.** The Orchid Links program holds the unclaimed funds on Solana. The link code stays in the URL fragment and lets the recipient's device derive the key to claim the funds. The sender can reclaim funds while the link is unclaimed.
- **Request a payment.** Share a public link for a specific amount, with an optional note. The request can be paid in Orchid or from a compatible Solana wallet through Solana Pay and Blinks. The external payer covers the network fee.

The Yape simulation demonstrates the payout flow for Peru. Real payouts would require a licensed payment partner.

## Built with

Solana, SPL Token, Anchor, WebAuthn passkeys, TanStack Start, React, Effect, Drizzle, Postgres, Cloudflare Workers and Hyperdrive, Bun, and Tailwind CSS.

## Run it locally

Install Bun and Node.js 22.12 or newer, and start Docker. Have a Solana devnet RPC URL from a provider ready for the setup prompt. You can also supply it through `SOLANA_RPC_URL` before running setup.

```sh
bun run setup
bun run dev
```

Open [localhost:3000](http://localhost:3000).

Setup installs dependencies, starts the local Postgres container `orchid-postgres` on port 55432, applies migrations, and configures the gitignored `apps/web/.dev.vars`. You can rerun setup. It preserves existing values and can reuse the main checkout's configuration in a worktree. If you leave the RPC URL blank, set `SOLANA_RPC_URL` in the local configuration before starting the app.

Setup creates a sponsor if needed and tries to fund it with devnet SOL. If the airdrop fails, fund the public sponsor address printed by setup at the [Solana faucet](https://faucet.solana.com), then rerun setup to open the sandbox payout partner's USDC token account.

### Browser tests

With Docker, Surfpool, and the Anchor toolchain installed, run:

```sh
bun run setup --e2e
anchor build --no-idl --ignore-keys
bun run --cwd apps/web test:e2e
```

The Playwright suite uses Chromium, a local Surfnet, and a separate disposable Postgres container.

## Team

Marcelo Vizcarra · https://mavix.dev

## License

[Apache License 2.0](LICENSE)
