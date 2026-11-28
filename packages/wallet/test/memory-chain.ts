import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { addressRules } from "../src/address-rules";
import {
  AccountAddress,
  type Asset,
  LinkUnclaimable,
  OpeningDraft,
  type PositiveAmount,
  SigningRequest,
  UnclaimedFundsId,
  UnsignedEnvelope,
  sameAsset,
} from "../src/contract";
import type { AssetPlan } from "../src/server/asset-plan.server";
import {
  type AccountStanding,
  Applied,
  ApprovalInvalid,
  Chain,
  ChainUnreachable,
  DraftPurpose,
  ExternalPayment,
  type LinkReceive,
  Sealed,
  Undecided,
} from "../src/server/Chain.server";
import type { UnclaimedFundsEntry } from "../src/server/unclaimed-funds.server";
import { approvalMargin, draftLifetime } from "../src/policy";
import { accountState, amount, holdingsReader, world } from "./ledger-world";
import { randomAddress, randomUnclaimedFundsId, signedBy } from "./test-keys";

type PreparedReceive = LinkReceive & { readonly createsLinkAccount: boolean };

type DraftedChange = Data.TaggedEnum<{
  Opened: {};
  Paid: { readonly sequence: string };
  Held: {
    readonly sequence: string;
    readonly unclaimedFunds: UnclaimedFundsId;
    readonly asset: Asset;
    readonly amount: PositiveAmount;
    readonly from: AccountAddress;
    readonly to: AccountAddress;
    readonly paymentLink: boolean;
  };
  AssetChanged: { readonly sequence: string; readonly plan: AssetPlan };
  LinkReceived: { readonly receive: PreparedReceive };
}>;

const DraftedChange = Data.taggedEnum<DraftedChange>();

interface RecordedDraft {
  readonly signer: AccountAddress;
  readonly expiresAt: number;
  readonly change: DraftedChange;
}

const drafts = new Map<string, RecordedDraft>();

const sealedDrafts = new Map<string, RecordedDraft>();

const reserveSponsor = randomAddress();

export const resetMemoryChain = () => {
  drafts.clear();
  sealedDrafts.clear();
};

export const memorySigningPayload = (envelope: UnsignedEnvelope) =>
  new TextEncoder().encode(envelope);

const heldEntry = (
  held: Data.TaggedEnum.Value<DraftedChange, "Held">,
): UnclaimedFundsEntry => ({
  unclaimedFunds: held.unclaimedFunds,
  asset: held.asset,
  amount: held.amount,
  claimOf: (account) =>
    account === held.from || account === held.to
      ? Option.some({ opensAt: Option.none(), claimableAt: () => true })
      : Option.none(),
  paymentLinkFrom: (sender) =>
    held.paymentLink && sender === held.from
      ? Option.some(held.to)
      : Option.none(),
});

export const settleDraft = (hash: string) => {
  world.evidence.set(hash, new Applied({ at: DateTime.nowUnsafe() }));

  const draft = sealedDrafts.get(hash);

  if (!draft) return;

  DraftedChange.$match(draft.change, {
    Opened: () => {},
    Paid: () => {},
    Held: (held) => {
      world.claimables.set(held.unclaimedFunds, heldEntry(held));
    },
    AssetChanged: ({ plan }) => {
      if (Predicate.isTagged(plan, "ClaimPlan"))
        world.claimables.delete(plan.unclaimedFunds);
    },
    LinkReceived: ({ receive }) => {
      world.claimables.delete(receive.unclaimedFunds);
    },
  });
};

export const draftedReceive = (request: SigningRequest) => {
  const change = drafts.get(request.envelope)?.change;

  return change && DraftedChange.$is("LinkReceived")(change)
    ? Option.some(change.receive)
    : Option.none();
};

const createsAccount = DraftedChange.$match({
  Opened: () => true,
  Paid: () => false,
  Held: () => false,
  AssetChanged: () => false,
  LinkReceived: ({ receive }) => receive.createsLinkAccount,
});

const ledgerDown = () =>
  Effect.fail(new ChainUnreachable({ cause: new Error("Ledger down") }));

const account = (address: AccountAddress) =>
  Effect.suspend(() =>
    world.ledgerDown
      ? ledgerDown()
      : Effect.succeed(Option.fromNullishOr(world.accounts.get(address))),
  );

const nextSequence = (address: AccountAddress) =>
  (BigInt(world.accounts.get(address)?.sequence ?? "100") + 1n).toString();

const follows = (address: AccountAddress, sequence: string) =>
  account(address).pipe(
    Effect.map(
      Option.exists(
        (state) => BigInt(state.sequence) + 1n === BigInt(sequence),
      ),
    ),
  );

const recordedDraft = (
  signer: AccountAddress,
  change: DraftedChange,
): Effect.Effect<SigningRequest> =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    const expiresAt = (Math.floor(now / 1000) + draftLifetime) * 1000;

    const envelope = Schema.decodeSync(UnsignedEnvelope)(
      `memory-draft-${crypto.randomUUID()}`,
    );

    drafts.set(envelope, { signer, expiresAt, change });

    return new SigningRequest({
      envelope,
      expiresAt: DateTime.makeUnsafe(expiresAt),
    });
  });

const heldDraft = (
  from: AccountAddress,
  to: AccountAddress,
  asset: Asset,
  value: PositiveAmount,
  paymentLink: boolean,
) =>
  recordedDraft(
    from,
    DraftedChange.Held({
      sequence: nextSequence(from),
      unclaimedFunds: randomUnclaimedFundsId(),
      asset,
      amount: value,
      from,
      to,
      paymentLink,
    }),
  );

const sameReceive = (left: PreparedReceive, right: PreparedReceive) =>
  left.createsLinkAccount === right.createsLinkAccount &&
  left.link === right.link &&
  left.unclaimedFunds === right.unclaimedFunds &&
  left.destination === right.destination &&
  left.memo?.type === right.memo?.type &&
  left.memo?.value === right.memo?.value &&
  sameAsset(left.asset, right.asset) &&
  left.amount === right.amount;

const holdings = holdingsReader(account, reserveSponsor);

const receiveBlocker: Chain["Service"]["receiveBlocker"] = (
  address,
  asset,
  value,
) =>
  holdings(address, [asset]).pipe(
    Effect.map((found) => {
      if (Option.isNone(found)) return Option.some("no_account");

      const line = found.value.lines.find((candidate) =>
        sameAsset(candidate.asset, asset),
      );

      if (!line) return Option.some("no_account");

      if (!line.authorized) return Option.some("not_authorized");

      return line.capacity < value ? Option.some("no_capacity") : Option.none();
    }),
  );

const seal: Chain["Service"]["seal"] = (request, approval, holder) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) => {
    const draft = drafts.get(request.envelope);

    if (
      !draft ||
      draft.signer !== holder ||
      draft.expiresAt !== DateTime.toEpochMillis(request.expiresAt) ||
      draft.expiresAt < now + approvalMargin * 1000 ||
      !signedBy(
        holder,
        memorySigningPayload(request.envelope),
        approval.signature,
      )
    )
      return Effect.fail(new ApprovalInvalid());

    const envelope = `${request.envelope}.${bytesToHex(approval.signature)}`;
    const hash = bytesToHex(sha256(new TextEncoder().encode(envelope)));

    sealedDrafts.set(hash, draft);

    return Effect.succeed(
      new Sealed({ envelope, hash, expiresAt: request.expiresAt }),
    );
  });

export const memoryChain = Layer.succeed(
  Chain,
  Chain.of({
    standing: (address) =>
      account(address).pipe(
        Effect.map(
          Option.match({
            onNone: (): AccountStanding => "absent",
            onSome: (state): AccountStanding =>
              Option.isSome(state.balance) ? "open" : "incomplete",
          }),
        ),
      ),
    balance: (address) =>
      account(address).pipe(
        Effect.map(Option.flatMap((state) => state.balance)),
      ),
    validAsset: () => true,
    holdings,
    unclaimedFunds: (ids) =>
      Effect.suspend(() =>
        world.claimablesDown
          ? ledgerDown()
          : Effect.succeed(
              ids.flatMap((id) => {
                const entry = world.claimables.get(id);

                return entry ? [entry] : [];
              }),
            ),
      ),
    unclaimedFundsClosedAt: (id) =>
      Effect.succeed(Option.fromUndefinedOr(world.closures.get(id))),
    draftPaymentLink: (from, to, asset, value) =>
      heldDraft(from, to, asset, value, true),
    draftAsset: (address, plan) =>
      recordedDraft(
        address,
        DraftedChange.AssetChanged({ sequence: nextSequence(address), plan }),
      ),
    receiveBlocker,
    draftCurrent: (request, purpose) =>
      Effect.suspend(() => {
        const draft = drafts.get(request.envelope);

        if (!draft) return Effect.succeed(false);

        return DraftPurpose.$match(purpose, {
          Transfer: ({ from }) =>
            draft.signer === from &&
            (DraftedChange.$is("Paid")(draft.change) ||
              DraftedChange.$is("Held")(draft.change))
              ? follows(from, draft.change.sequence)
              : Effect.succeed(false),
          AssetChange: ({ address, plan }) =>
            draft.signer === address &&
            DraftedChange.$is("AssetChanged")(draft.change) &&
            JSON.stringify(draft.change.plan) === JSON.stringify(plan)
              ? follows(address, draft.change.sequence)
              : Effect.succeed(false),
          LinkReceive: ({ receive }) =>
            Effect.succeed(
              DraftedChange.$is("LinkReceived")(draft.change) &&
                sameReceive(draft.change.receive, receive),
            ),
        });
      }),
    unclaimedFundsCreatedBy: (request) => {
      const change = drafts.get(request.envelope)?.change;

      return change && DraftedChange.$is("Held")(change)
        ? Option.some(change.unclaimedFunds)
        : Option.none();
    },
    prepareLinkReceive: (receive) =>
      account(receive.link).pipe(
        Effect.map((state) =>
          Option.exists(state, ({ untouched }) => !untouched)
            ? new LinkUnclaimable({ reason: "link_account_unexpected" })
            : { ...receive, createsLinkAccount: Option.isNone(state) },
        ),
      ),
    draftLinkReceive: (receive) =>
      recordedDraft(receive.link, DraftedChange.LinkReceived({ receive })),
    cleanUpLink: (link) =>
      Effect.sync(
        () => !world.unmergeable.has(link) && !world.accounts.delete(link),
      ),
    depositsInto: (wallet, after) =>
      Stream.unwrap(
        Effect.suspend(() => {
          if (world.ledgerDown) return ledgerDown();

          const received = world.deposits.get(wallet) ?? [];

          const start = Option.match(after, {
            onNone: () => 0,
            onSome: ({ cursor }) =>
              received.findIndex((deposit) => deposit.eventId === cursor) + 1,
          });

          return Effect.succeed(
            Stream.fromIterable(received.slice(start)).pipe(
              Stream.mapEffect((deposit) =>
                world.unreadableDeposits.has(deposit.eventId)
                  ? ledgerDown()
                  : Effect.succeed({
                      deposits: [deposit],
                      position: {
                        cursor: deposit.eventId,
                        ledger: deposit.ledger,
                      },
                    }),
              ),
            ),
          );
        }),
      ),
    validAddress: addressRules.hasValidChecksum,
    pastOpeningWindow: (sealed) =>
      Effect.map(
        Clock.currentTimeMillis,
        (now) => DateTime.toEpochMillis(sealed.expiresAt) < now,
      ),
    draftOpening: (address) =>
      recordedDraft(address, DraftedChange.Opened()).pipe(
        Effect.map((request) => new OpeningDraft({ request })),
      ),
    draftPayment: (from) =>
      recordedDraft(from, DraftedChange.Paid({ sequence: nextSequence(from) })),
    seal,
    submit: (sealed) =>
      Effect.suspend(() => {
        if (world.failSubmit) return ledgerDown();

        world.submitted.push(sealed);

        const draft = sealedDrafts.get(sealed.hash);

        if (draft && createsAccount(draft.change))
          world.accounts.set(
            draft.signer,
            accountState({
              sequence: world.accounts.get(draft.signer)?.sequence ?? "1000",
              balance: Option.some(amount("0")),
            }),
          );

        return Effect.void;
      }),
    draftExternalPayment: () =>
      Effect.suspend(() =>
        world.ledgerDown
          ? ledgerDown()
          : Effect.map(Clock.currentTimeMillis, (now) => {
              const transaction = `memory-external-${crypto.randomUUID()}`;

              return new ExternalPayment({
                reference: randomAddress(),
                transaction,
                envelope: transaction,
                expiresAt: DateTime.makeUnsafe(
                  (Math.floor(now / 1000) + draftLifetime) * 1000,
                ),
              });
            }),
      ),
    externalPaymentSettlement: (payment) =>
      Effect.suspend(() =>
        world.ledgerDown
          ? ledgerDown()
          : Effect.succeed(
              world.evidence.get(payment.reference) ?? new Undecided(),
            ),
      ),
    settlement: (sealed) =>
      Effect.suspend(() =>
        world.unreadable.has(sealed.hash)
          ? Effect.die(new Error("Malformed ledger reply"))
          : Effect.succeed(world.evidence.get(sealed.hash) ?? new Undecided()),
      ),
  }),
);
