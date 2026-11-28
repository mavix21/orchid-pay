import { describe, expect, it } from "vitest";

import {
  findUnclaimedFundsAddress,
  findVaultAddress,
  getCreateInstruction,
  orchidLinksErrorCode,
  USDC_MINT_ADDRESS,
} from "../src";
import {
  anchorErrorCode,
  createLinkHarness,
  TOKEN_2022_PROGRAM_ADDRESS,
  withAccount,
} from "./link-harness";

const sevenDays = 7n * 24n * 60n * 60n;

describe("create", () => {
  it("moves the amount into the vault and records the link with a seven-day reclaim time", async () => {
    const harness = await createLinkHarness();
    const createdAt = harness.now();

    const created = await harness.createLink(2_500_000n);
    const [vault] = await findVaultAddress(created.address);

    expect(created.outcome).toEqual({ kind: "succeeded" });
    expect(harness.tokenBalance(created.source)).toBe(0n);
    expect(harness.tokenBalance(vault)).toBe(2_500_000n);
    expect(harness.unclaimedFunds(created.address)).toEqual({
      sender: harness.sender.address,
      link: created.link.address,
      mint: USDC_MINT_ADDRESS,
      rentRecipient: harness.sponsor.address,
      amount: 2_500_000n,
      reclaimableAt: createdAt + sevenDays,
      bump: created.bump,
    });
  });

  it.each([
    { name: "shorter", size: 15 },
    { name: "longer", size: 17 },
  ])("refuses an order id $name than 16 bytes", async ({ size }) => {
    const harness = await createLinkHarness();
    const link = await harness.unfundedSigner();

    await expect(
      findUnclaimedFundsAddress(
        harness.sender.address,
        link.address,
        new Uint8Array(size),
      ),
    ).rejects.toThrow(RangeError);

    await expect(
      getCreateInstruction({
        sender: harness.sender.address,
        rentRecipient: harness.sponsor.address,
        source: harness.sender.address,
        link: link.address,
        orderId: new Uint8Array(size),
        amount: 1n,
      }),
    ).rejects.toThrow(RangeError);
  });

  it("rejects a zero amount", async () => {
    const harness = await createLinkHarness();

    const created = await harness.createLink(0n);

    expect(created.outcome).toEqual({
      kind: "failed",
      code: orchidLinksErrorCode.zeroAmount,
    });
  });

  it("rejects a link key equal to the sender", async () => {
    const harness = await createLinkHarness();
    const source = await harness.tokenAccount(harness.sender.address, 10n);

    const outcome = await harness.send(
      harness.sponsor,
      [
        await getCreateInstruction({
          sender: harness.sender.address,
          rentRecipient: harness.sponsor.address,
          source,
          link: harness.sender.address,
          orderId: new Uint8Array(16),
          amount: 10n,
        }),
      ],
      [harness.sender],
    );

    expect(outcome).toEqual({
      kind: "failed",
      code: orchidLinksErrorCode.linkIsSender,
    });
  });

  it("keeps another sender from taking the sender's link address", async () => {
    const harness = await createLinkHarness();
    const squatter = await harness.fundedSigner();
    const link = await harness.unfundedSigner();
    const orderId = new Uint8Array(16).fill(7);
    const squatterSource = await harness.tokenAccount(squatter.address, 10n);

    const senderSource = await harness.tokenAccount(
      harness.sender.address,
      10n,
    );

    const [senderLink] = await findUnclaimedFundsAddress(
      harness.sender.address,
      link.address,
      orderId,
    );

    const [senderVault] = await findVaultAddress(senderLink);

    const squatterCreate = await getCreateInstruction({
      sender: squatter.address,
      rentRecipient: harness.sponsor.address,
      source: squatterSource,
      link: link.address,
      orderId,
      amount: 10n,
    });

    const forged = await harness.send(
      harness.sponsor,
      [withAccount(withAccount(squatterCreate, 2, senderLink), 3, senderVault)],
      [squatter],
    );

    const squatted = await harness.send(
      harness.sponsor,
      [squatterCreate],
      [squatter],
    );

    const created = await harness.send(
      harness.sponsor,
      [
        await getCreateInstruction({
          sender: harness.sender.address,
          rentRecipient: harness.sponsor.address,
          source: senderSource,
          link: link.address,
          orderId,
          amount: 10n,
        }),
      ],
      [harness.sender],
    );

    expect(forged).toEqual({
      kind: "failed",
      code: anchorErrorCode.constraintSeeds,
    });
    expect(squatted).toEqual({ kind: "succeeded" });
    expect(created).toEqual({ kind: "succeeded" });
    expect(harness.unclaimedFunds(senderLink)?.sender).toBe(
      harness.sender.address,
    );
  });

  it.each([
    {
      name: "a mint other than USDC",
      account: 4,
      replacement: "otherMint",
      code: anchorErrorCode.constraintAddress,
    },
    {
      name: "the Token-2022 program",
      account: 6,
      replacement: "token2022",
      code: anchorErrorCode.invalidProgramId,
    },
  ] as const)("rejects $name", async ({ account, replacement, code }) => {
    const harness = await createLinkHarness();
    const otherMint = await harness.otherMint();

    const replacements = {
      otherMint,
      token2022: TOKEN_2022_PROGRAM_ADDRESS,
    };

    const sourceMints = {
      otherMint,
      token2022: USDC_MINT_ADDRESS,
    };

    const source = await harness.tokenAccount(
      harness.sender.address,
      10n,
      sourceMints[replacement],
    );

    const link = await harness.unfundedSigner();

    const create = await getCreateInstruction({
      sender: harness.sender.address,
      rentRecipient: harness.sponsor.address,
      source,
      link: link.address,
      orderId: new Uint8Array(16),
      amount: 10n,
    });

    const outcome = await harness.send(
      harness.sponsor,
      [withAccount(create, account, replacements[replacement])],
      [harness.sender],
    );

    expect(outcome).toEqual({ kind: "failed", code });
  });

  it.each([
    { name: "link account", prefunded: "link", lamports: 1n },
    { name: "vault", prefunded: "vault", lamports: 1n },
    {
      name: "link account above rent",
      prefunded: "link",
      lamports: 1_000_000_000n,
    },
    { name: "vault above rent", prefunded: "vault", lamports: 1_000_000_000n },
  ] as const)(
    "creates the link when its $name already holds lamports",
    async ({ prefunded, lamports }) => {
      const harness = await createLinkHarness();
      const link = await harness.unfundedSigner();
      const orderId = new Uint8Array(16).fill(3);
      const source = await harness.tokenAccount(harness.sender.address, 10n);

      const [linkAccount] = await findUnclaimedFundsAddress(
        harness.sender.address,
        link.address,
        orderId,
      );

      const [vault] = await findVaultAddress(linkAccount);
      harness.prefund({ link: linkAccount, vault }[prefunded], lamports);

      const outcome = await harness.send(
        harness.sponsor,
        [
          await getCreateInstruction({
            sender: harness.sender.address,
            rentRecipient: harness.sponsor.address,
            source,
            link: link.address,
            orderId,
            amount: 10n,
          }),
        ],
        [harness.sender],
      );

      expect(outcome).toEqual({ kind: "succeeded" });
      expect(harness.tokenBalance(vault)).toBe(10n);
    },
  );
});
