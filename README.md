<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/orchid-logo-dark.png" />
    <img src="docs/assets/orchid-logo-light.png" alt="Orchid Pay" height="44" />
  </picture>
</p>

<h3 align="center">Dollars that move by link.</h3>

<p align="center">
  Self-custodial USDC wallet on Solana devnet for Latin America, starting in Peru.<br />
  Built for the dev3pack Solana hackathon · English &amp; Spanish
</p>

<p align="center">
  <img src="docs/assets/core-flow.gif" alt="Orchid Pay core flow: share a payment link, claim into a new passkey wallet or cash out via simulated Yape, and settle a payment request from an external Solana wallet" width="700" />
</p>

## Why Orchid

- **Every payment link is a new-user channel.** Send USDC in a chat message. The `orchid-links` Anchor program holds the unclaimed funds on Solana while the claim key stays in the URL `#fragment` (never sent to the server). A recipient with no wallet opens the link and claims straight into a new passkey-backed wallet in two taps, with fees and token-account rent sponsored. The sender can reclaim unclaimed funds at any time; whichever of claim or reclaim lands first wins.
- **Local cash-out from the same link.** Recipients who want local currency instead of a wallet tap **Yape** on the exact same payment link, enter a Peruvian mobile number, review the soles quote, and track settlement. _(On devnet this uses a simulated payout partner — no real soles are transferred; live payouts require a licensed partner.)_
- **Request links payable from any Solana wallet.** Share a public `/pay/<id>` link for an exact USDC amount and optional note. Payers settle in Orchid or from an external Solana wallet such as Phantom or Solflare via Solana Pay and Blinks (the external payer covers the network fee).

## Mobile screens

<table>
  <tr>
    <td align="center" width="25%">
      <img src="docs/assets/payment-link-offer.png" alt="Payment link offer screen showing 50 USDC from @rosa with Orchid, Yape, and external wallet options" width="195" />
      <br />
      <sub><strong>Payment link</strong><br />Claim in Orchid, Yape, or another wallet</sub>
    </td>
    <td align="center" width="25%">
      <img src="docs/assets/yape-payout-simulation.png" alt="Simulated Yape payout tracker showing devnet simulation notice and completed PEN payout" width="195" />
      <br />
      <sub><strong>Yape cash-out (sim)</strong><br />Soles quote &amp; live status tracker</sub>
    </td>
    <td align="center" width="25%">
      <img src="docs/assets/payment-request-solana-pay.png" alt="Public payment request page for 20 USDC with Solana Pay QR code and Orchid pay button" width="195" />
      <br />
      <sub><strong>Payment request</strong><br />Solana Pay QR, Blinks, or Orchid</sub>
    </td>
    <td align="center" width="25%">
      <img src="docs/assets/wallet-home.png" alt="Orchid passkey wallet home screen showing balance, quick actions, and activity" width="195" />
      <br />
      <sub><strong>Passkey wallet</strong><br />Self-custodial USDC &amp; activity</sub>
    </td>
  </tr>
</table>

## Built with

Solana, SPL Token, Anchor (`orchid-links`), Solana Pay & Blinks, WebAuthn PRF passkeys, TanStack Start, React, Effect, Drizzle, Postgres, Cloudflare Workers & Hyperdrive, Bun, and Tailwind CSS.

## Run it locally

Install Bun and Node.js 22.12+, and start Docker. Have a Solana devnet RPC URL ready for the setup prompt (or set `SOLANA_RPC_URL` beforehand).

```sh
bun run setup
bun run dev
```

Open [localhost:3000](http://localhost:3000).

Setup installs dependencies, starts the local Postgres container `orchid-postgres` on port `55432`, applies migrations, and configures the gitignored `apps/web/.dev.vars`. Rerun setup safely at any time to preserve existing values or reuse the main checkout's config in a worktree.

Setup creates a devnet sponsor if needed and attempts a SOL airdrop. If the airdrop fails, fund the printed public sponsor address at the [Solana faucet](https://faucet.solana.com) and rerun setup to open the simulated payout partner's USDC token account.

### Browser tests

With Docker, Surfpool, and the Anchor toolchain installed:

```sh
bun run setup --e2e
anchor build --no-idl --ignore-keys
bun run --cwd apps/web test:e2e
```

Playwright runs against Chromium, a local Surfnet, and a disposable Postgres container.

## Team & License

Marcelo Vizcarra · [mavix.dev](https://mavix.dev) · [Apache License 2.0](LICENSE)
