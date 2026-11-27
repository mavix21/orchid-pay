import { describe, expect, it } from "vitest";

import {
  findVaultAddress,
  getClaimInstruction,
  getReclaimInstruction,
  orchidLinksErrorCode,
  RECLAIM_DELAY_SECONDS,
} from "../src";
import {
  anchorErrorCode,
  createLinkHarness,
  withAccount,
} from "./link-harness";

const releases = {
  claim: getClaimInstruction,
  reclaim: getReclaimInstruction,
};

describe("claim", () => {
  it("pays the vault's whole balance, including a stray donation, and returns all rent to the rent recipient", async () => {
    const harness = await createLinkHarness();
    const created = await harness.createLink(1_000_000n);
    const [vault] = await findVaultAddress(created.address);
    await harness.donate(vault, 1n);
    const recipient = await harness.unfundedSigner();
    const destination = await harness.tokenAccount(recipient.address, 0n);
    const feePayer = await harness.fundedSigner();

    const heldRent =
      harness.lamportBalance(created.address) + harness.lamportBalance(vault);

    const rentRecipientBefore = harness.lamportBalance(harness.sponsor.address);

    const outcome = await harness.send(
      feePayer,
      [
        await getClaimInstruction({
          signer: created.link.address,
          unclaimedFunds: created.address,
          destination,
          rentRecipient: harness.sponsor.address,
        }),
      ],
      [created.link],
    );

    expect(outcome).toEqual({ kind: "succeeded" });
    expect(harness.tokenBalance(destination)).toBe(1_000_001n);
    expect(harness.tokenBalance(vault)).toBeNull();
    expect(harness.unclaimedFunds(created.address)).toBeNull();
    expect(harness.lamportBalance(harness.sponsor.address)).toBe(
      rentRecipientBefore + heldRent,
    );
  });

  it("pays nothing twice", async () => {
    const harness = await createLinkHarness();
    const created = await harness.createLink(1_000_000n);
    const destination = await harness.tokenAccount(created.link.address, 0n);

    const claim = await getClaimInstruction({
      signer: created.link.address,
      unclaimedFunds: created.address,
      destination,
      rentRecipient: harness.sponsor.address,
    });

    const first = await harness.send(harness.sponsor, [claim], [created.link]);
    const second = await harness.send(harness.sponsor, [claim], [created.link]);

    expect(first).toEqual({ kind: "succeeded" });
    expect(second).toEqual({
      kind: "failed",
      code: anchorErrorCode.accountNotInitialized,
    });
    expect(harness.tokenBalance(destination)).toBe(1_000_000n);
  });

  it("rejects a destination of another mint", async () => {
    const harness = await createLinkHarness();
    const created = await harness.createLink();

    const destination = await harness.tokenAccount(
      created.link.address,
      0n,
      await harness.otherMint(),
    );

    const outcome = await harness.send(
      harness.sponsor,
      [
        await getClaimInstruction({
          signer: created.link.address,
          unclaimedFunds: created.address,
          destination,
          rentRecipient: harness.sponsor.address,
        }),
      ],
      [created.link],
    );

    expect(outcome).toEqual({
      kind: "failed",
      code: anchorErrorCode.constraintTokenMint,
    });
  });
});

describe("reclaim", () => {
  it("refuses before the reclaim time and pays the sender back once it arrives", async () => {
    const harness = await createLinkHarness();
    const createdAt = harness.now();
    const created = await harness.createLink(1_000_000n);

    const reclaim = await getReclaimInstruction({
      signer: harness.sender.address,
      unclaimedFunds: created.address,
      destination: created.source,
      rentRecipient: harness.sponsor.address,
    });

    harness.setNow(createdAt + RECLAIM_DELAY_SECONDS - 1n);

    const early = await harness.send(
      harness.sponsor,
      [reclaim],
      [harness.sender],
    );

    harness.setNow(createdAt + RECLAIM_DELAY_SECONDS);

    const due = await harness.send(
      harness.sponsor,
      [reclaim],
      [harness.sender],
    );

    expect(early).toEqual({
      kind: "failed",
      code: orchidLinksErrorCode.notYetReclaimable,
    });
    expect(due).toEqual({ kind: "succeeded" });
    expect(harness.tokenBalance(created.source)).toBe(1_000_000n);
    expect(harness.unclaimedFunds(created.address)).toBeNull();
  });
});

describe.each([
  { name: "claim", release: "claim" },
  { name: "reclaim", release: "reclaim" },
] as const)("$name", ({ release }) => {
  it("rejects a signer that does not control the link", async () => {
    const harness = await createLinkHarness();
    const created = await harness.createLink();
    harness.setNow(harness.now() + RECLAIM_DELAY_SECONDS);
    const stranger = await harness.unfundedSigner();
    const destination = await harness.tokenAccount(stranger.address, 0n);

    const outcome = await harness.send(
      harness.sponsor,
      [
        await releases[release]({
          signer: stranger.address,
          unclaimedFunds: created.address,
          destination,
          rentRecipient: harness.sponsor.address,
        }),
      ],
      [stranger],
    );

    expect(outcome).toEqual({
      kind: "failed",
      code: orchidLinksErrorCode.wrongSigner,
    });
  });

  it("rejects closing to anyone but the stored rent recipient", async () => {
    const harness = await createLinkHarness();
    const created = await harness.createLink();
    harness.setNow(harness.now() + RECLAIM_DELAY_SECONDS);
    const signers = { claim: created.link, reclaim: harness.sender };
    const thief = await harness.fundedSigner();
    const destination = await harness.tokenAccount(thief.address, 0n);

    const releaseInstruction = await releases[release]({
      signer: signers[release].address,
      unclaimedFunds: created.address,
      destination,
      rentRecipient: harness.sponsor.address,
    });

    const outcome = await harness.send(
      thief,
      [withAccount(releaseInstruction, 4, thief.address)],
      [signers[release]],
    );

    expect(outcome).toEqual({
      kind: "failed",
      code: orchidLinksErrorCode.wrongRentRecipient,
    });
  });
});
