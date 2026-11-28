import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type { AccountAddress, TransferOrder } from "../contract";
import {
  type CorruptDeviceWallet,
  type KeyStoreUnavailable,
  PublicDeviceWallet,
  type SealedKeyStore,
} from "./key-store";
import type { SealedLinkCode } from "./link-seal";
import type { PaymentFacts, PaymentLinkFacts } from "../device-network";
import { ApprovalOutstanding, DraftRejected, NoWallet } from "./outcomes";
import { Reserved } from "./reviewed-approval";
import { restoredLinkSlot, savedLinkFor, withSavedLink } from "./saved-links";
import {
  approvalOutstanding,
  nextLinkReceipt,
  sameOrderSlot,
} from "./transfer-drafts";

const nowSeconds = Effect.map(DateTime.now, (now) =>
  Math.floor(DateTime.toEpochMillis(now) / 1000),
);

export interface LinkSlot {
  readonly address: AccountAddress;
  readonly previous: Option.Option<SealedLinkCode>;
}

export interface FundingReservation {
  readonly wallet: PublicDeviceWallet;
  readonly link: Option.Option<LinkSlot>;
}

export const reserveApproval = Effect.fn("Device.reserveApproval")(function* (
  store: SealedKeyStore,
  reviewed: PublicDeviceWallet,
  order: TransferOrder,
  facts: PaymentFacts | PaymentLinkFacts,
  sealed: Option.Option<SealedLinkCode> = Option.none(),
): Effect.fn.Return<
  Reserved<FundingReservation> | ApprovalOutstanding | DraftRejected | NoWallet,
  KeyStoreUnavailable | CorruptDeviceWallet
> {
  const now = yield* nowSeconds;
  let link = Option.none<LinkSlot>();

  const committed = yield* store.updateRecords(({ wallet: current, links }) => {
    if (!sameOrderSlot(current, reviewed) || approvalOutstanding(current, now))
      return Option.none();

    link = Option.map(sealed, (saved) => ({
      address: saved.address,
      previous: savedLinkFor(links, saved.wallet, saved.address),
    }));

    return Option.some({
      wallet: new PublicDeviceWallet({
        ...current,
        approvedUntil: facts.maxTime,
        linkReceipt: Predicate.isTagged(facts, "PaymentLinkFacts")
          ? nextLinkReceipt(current.linkReceipt, facts)
          : current.linkReceipt,
      }),
      links: Option.match(sealed, {
        onNone: () => links,
        onSome: (saved) => withSavedLink(links, saved),
      }),
    });
  });

  if (Option.isNone(committed)) return new NoWallet();

  const current = committed.value.records.wallet;

  if (committed.value.updated)
    return new Reserved({ reservation: { wallet: current, link } });

  return current.transfer?.id === order.id && approvalOutstanding(current, now)
    ? new ApprovalOutstanding({ order })
    : new DraftRejected();
});

export const withdrawReservation = (
  store: SealedKeyStore,
  reservation: FundingReservation,
  previous: PublicDeviceWallet,
) =>
  store
    .updateRecords(({ wallet: current, links }) =>
      sameOrderSlot(current, reservation.wallet)
        ? Option.some({
            wallet: new PublicDeviceWallet({
              ...current,
              approvedUntil: previous.approvedUntil,
              linkReceipt: previous.linkReceipt,
            }),
            links: Option.match(reservation.link, {
              onNone: () => links,
              onSome: (slot) =>
                restoredLinkSlot(
                  links,
                  current.address,
                  slot.address,
                  slot.previous,
                ),
            }),
          })
        : Option.none(),
    )
    .pipe(Effect.asVoid);
