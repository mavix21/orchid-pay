import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import {
  AccountAddress,
  PaymentLinkNotFound,
  PaymentLinkRecipient,
  type Pending,
  type WalletPort,
  type WalletUnavailable,
  TransferIntent,
} from "../contract";
import { network } from "../device-network";
import {
  AssertionIntent,
  AssertionRejected,
  OperationVerified,
  verifyPinnedAssertion,
} from "./assertion";
import {
  type CorruptDeviceWallet,
  type KeyStore,
  type KeyStoreUnavailable,
  clearStoredLink,
  clearedLink,
  sameLinkState,
} from "./key-store";
import {
  generateLinkCode,
  linkAddressOf,
  linkPath,
  type LinkCode,
} from "./link-code";
import {
  SavedLinkCorrupt,
  LinkCodeOpened,
  type SealedLinkCode,
  linkPrfInput,
  matchesLinkContext,
  openLinkCode,
  sealLinkCode,
} from "./link-seal";
import {
  ApprovalOutstanding,
  type ConfirmPaymentLinkOutcome,
  DraftRejected,
  LatestPaymentLink,
  LinkOutputMissing,
  SavedLinkMissing,
  ListedPaymentLink,
  ListedPaymentLinks,
  NoWallet,
  PaymentLinkCreated,
  type PaymentLinkIntent,
  PaymentLinkRevealed,
  type PaymentLinksOutcome,
  type PaymentReview,
  type ResolvePaymentLinkOutcome,
  type RevealPaymentLinkOutcome,
  type ReviewPaymentLinkOutcome,
  type SavedLinkTarget,
  UnsupportedDevice,
} from "./outcomes";
import type { PasskeyCancelled, PasskeyFailed } from "./passkeys";
import { recordFunded, recordsStore, savedLinkFor } from "./saved-links";
import { type LinkSaving, type Reviews, sendTransfer } from "./sending";
import { directRoute } from "./transfer-route";

const clockAllowance = 60;

const nowSeconds = Effect.map(DateTime.now, (now) =>
  Math.floor(DateTime.toEpochMillis(now) / 1000),
);

export interface HeldLink {
  readonly address: AccountAddress;
  readonly code: LinkCode;
  readonly saveOnDevice: boolean;
}

export function devicePaymentLinks(
  port: WalletPort,
  store: KeyStore,
  reviews: Reviews,
  held: Ref.Ref<Option.Option<HeldLink>>,
) {
  const transfers = sendTransfer(port, directRoute(port), store, reviews);
  const records = recordsStore(store, reviews.device?.store);

  const saving = (
    wallet: AccountAddress,
    link: HeldLink,
  ): Effect.Effect<
    Option.Option<LinkSaving<LinkOutputMissing | DraftRejected>>
  > =>
    link.saveOnDevice
      ? Effect.map(
          linkPrfInput({ network, wallet, address: link.address }),
          (input) =>
            Option.some({
              input,
              seal: (record, output) =>
                Option.match(output, {
                  onNone: () => Effect.succeed(new LinkOutputMissing()),
                  onSome: (prf) =>
                    sealLinkCode(
                      {
                        network,
                        wallet: record.public.address,
                        address: link.address,
                        credentialId: record.credential.id,
                      },
                      link.code,
                      prf,
                    ).pipe(
                      Effect.map(
                        Option.getOrElse(
                          (): SealedLinkCode | DraftRejected =>
                            new DraftRejected(),
                        ),
                      ),
                    ),
                }),
            }),
        )
      : Effect.succeed(Option.none());

  const review = Effect.fn("Device.reviewPaymentLink")(function* (
    intent: PaymentLinkIntent,
  ): Effect.fn.Return<
    ReviewPaymentLinkOutcome,
    WalletUnavailable | KeyStoreUnavailable
  > {
    const code = generateLinkCode();
    const derived = linkAddressOf(code);

    if (Option.isNone(derived)) return new DraftRejected();

    const address = derived.value;

    const reviewed = yield* transfers.reviewLinkFunding(
      new TransferIntent({
        to: PaymentLinkRecipient.make({ value: address }),
        asset: intent.asset,
        amount: intent.amount,
      }),
    );

    if (Predicate.isTagged(reviewed, "Settled")) return new DraftRejected();

    if (Predicate.isTagged(reviewed, "PaymentReview"))
      yield* Ref.set(
        held,
        Option.some({ address, code, saveOnDevice: intent.saveOnDevice }),
      );

    return reviewed;
  });

  const confirm = Effect.fn("Device.confirmPaymentLink")(function* (
    shown: PaymentReview,
  ): Effect.fn.Return<
    ConfirmPaymentLinkOutcome,
    WalletUnavailable | KeyStoreUnavailable | CorruptDeviceWallet
  > {
    const link = Option.filter(
      yield* Ref.get(held),
      ({ address }) =>
        Predicate.isTagged(shown.order.to, "PaymentLink") &&
        shown.order.to.value === address,
    );

    if (Option.isNone(link)) return new DraftRejected();

    const outcome = yield* transfers.confirmLinkFunding(
      shown,
      Option.getOrUndefined(yield* saving(shown.order.from, link.value)),
    );

    if (!Predicate.isTagged(outcome, "Settled")) return outcome;

    if (outcome.unclaimedFunds === undefined) return new DraftRejected();

    const { address, code, saveOnDevice } = link.value;

    yield* Ref.update(held, (current) =>
      Option.exists(current, (kept) => kept.address === address)
        ? Option.none()
        : current,
    );

    return new PaymentLinkCreated({
      id: outcome.id,
      address,
      code,
      unclaimedFunds: outcome.unclaimedFunds,
      asset: outcome.asset,
      amount: outcome.amount,
      network,
      path: linkPath(code),
      settledAt: outcome.settledAt,
      savedOnDevice: saveOnDevice,
    });
  });

  const paymentLinks = Effect.fn("Device.paymentLinks")(
    function* (): Effect.fn.Return<
      PaymentLinksOutcome,
      WalletUnavailable | KeyStoreUnavailable
    > {
      const stored = yield* store.readPublic();

      if (Option.isNone(stored)) return new NoWallet();

      const wallet = stored.value.address;
      const listed = yield* port.paymentLinks(wallet);

      if (!Predicate.isTagged(listed, "OpenPaymentLinks")) return listed;

      const saved = yield* records.readLinks();

      return new ListedPaymentLinks({
        received: listed.received,
        links: listed.links.map(
          (link) =>
            new ListedPaymentLink({
              ...link,
              savedOnDevice: Option.isSome(
                savedLinkFor(saved, wallet, link.address),
              ),
            }),
        ),
      });
    },
  );

  const resolvePaymentLink = Effect.fn("Device.resolvePaymentLink")(
    function* (): Effect.fn.Return<
      ResolvePaymentLinkOutcome,
      WalletUnavailable | KeyStoreUnavailable
    > {
      const stored = yield* store.readPublic();

      if (Option.isNone(stored)) return new NoWallet();

      const wallet = stored.value;
      const receipt = wallet.linkReceipt;

      if (receipt === undefined) return new PaymentLinkNotFound();

      const clearTarget = {
        address: wallet.address,
        transferId: wallet.transfer?.id,
        approvedUntil: wallet.approvedUntil,
        receipt,
      };

      let concluded = false;
      let pendingStatus: Pending | undefined;

      if (
        wallet.transfer !== undefined &&
        Predicate.isTagged(wallet.transfer.to, "PaymentLink") &&
        wallet.approvedUntil !== undefined
      ) {
        const status = yield* port.transfer(wallet.transfer, Option.none());

        if (Predicate.isTagged(status, "Pending")) pendingStatus = status;

        concluded =
          Predicate.isTagged(status, "Settled") ||
          Predicate.isTagged(status, "Failed");
      }

      const resolved = yield* port.resolvePaymentLink(wallet.address, receipt);

      if (Predicate.isTagged(resolved, "ResolvedPaymentLink")) {
        const settled = yield* records.updateRecords(
          ({ wallet: current, links }) =>
            Option.some({
              wallet: sameLinkState(current, clearTarget)
                ? clearedLink(current)
                : current,
              links: recordFunded(
                links,
                current.address,
                resolved.address,
                resolved.unclaimedFunds,
              ),
            }),
        );

        return new LatestPaymentLink({
          unclaimedFunds: resolved.unclaimedFunds,
          address: resolved.address,
          asset: resolved.asset,
          amount: resolved.amount,
          savedOnDevice: Option.exists(settled, ({ records: kept }) =>
            Option.isSome(
              savedLinkFor(kept.links, kept.wallet.address, resolved.address),
            ),
          ),
        });
      }

      if (Predicate.isTagged(resolved, "PaymentLinkNotFound")) {
        if (pendingStatus !== undefined) return pendingStatus;

        const now = yield* nowSeconds;

        if (
          !concluded &&
          wallet.transfer !== undefined &&
          wallet.approvedUntil !== undefined &&
          wallet.approvedUntil + clockAllowance >= now
        )
          return new ApprovalOutstanding({ order: wallet.transfer });

        yield* clearStoredLink(store, clearTarget);
      }

      return resolved;
    },
  );

  const reveal = Effect.fn("Device.revealPaymentLink")(function* (
    target: SavedLinkTarget,
  ): Effect.fn.Return<
    RevealPaymentLinkOutcome,
    KeyStoreUnavailable | CorruptDeviceWallet | PasskeyCancelled | PasskeyFailed
  > {
    const { device } = reviews;

    if (device === undefined) return new UnsupportedDevice();

    const sealed = yield* device.store.readSealed();

    if (Option.isNone(sealed)) return new NoWallet();

    const { credential } = sealed.value;
    const wallet = sealed.value.public.address;

    const saved = Option.filter(
      savedLinkFor(yield* device.store.readLinks(), wallet, target.address),
      ({ unclaimedFunds }) =>
        unclaimedFunds === undefined ||
        unclaimedFunds === target.unclaimedFunds,
    );

    if (Option.isNone(saved)) return new SavedLinkMissing();

    const context = {
      network,
      wallet,
      address: target.address,
      credentialId: credential.id,
    };

    if (!matchesLinkContext(saved.value, context))
      return new SavedLinkCorrupt();

    const verified = yield* verifyPinnedAssertion(
      device.ceremony,
      device.relyingParty(),
      credential,
      AssertionIntent.Operation({
        purpose: "disclosure",
        prf: {
          first: yield* linkPrfInput(context),
          second: Option.none(),
        },
      }),
    );

    if (Predicate.isTagged(verified, "EntryVerified"))
      return new AssertionRejected();

    if (!(verified instanceof OperationVerified)) return verified;

    const opened = yield* openLinkCode(
      saved.value,
      context,
      verified.prf.first,
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          Redacted.value(verified.prf.first).fill(0);
        }),
      ),
    );

    if (!(opened instanceof LinkCodeOpened)) return opened;

    const code = Redacted.value(opened.code);

    return new PaymentLinkRevealed({
      address: target.address,
      code,
      path: linkPath(code),
      unclaimedFunds: target.unclaimedFunds,
      asset: target.asset,
      amount: target.amount,
    });
  });

  return {
    review,
    confirm,
    paymentLinks,
    resolvePaymentLink,
    reveal,
  };
}
