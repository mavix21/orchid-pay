import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type {
  AccountAddress,
  Failed,
  PaymentRequestId,
  Settled,
  TransferIntent,
  TransferOrder,
} from "../contract";
import { PublicDeviceWallet } from "./key-store";
import { type RecordsStore, concludedLink } from "./saved-links";
import { matchesIntent, orderRevision, sameOrderSlot } from "./transfer-drafts";

export const forgetOrder = (
  records: RecordsStore,
  address: AccountAddress,
  order: TransferOrder,
  concluded: Settled | Failed,
) =>
  records
    .updateRecords(({ wallet: current, links }) => {
      if (current.address !== address) return Option.none();

      const concludedLinks = concludedLink(
        links,
        current.address,
        order,
        concluded,
      );

      const clears = current.transfer?.id === order.id;

      if (!clears && concludedLinks === links) return Option.none();

      return Option.some({
        wallet: clears
          ? new PublicDeviceWallet({
              ...current,
              transfer: undefined,
              approvedUntil: undefined,
              linkReceipt: undefined,
              paymentRequest: undefined,
              transferRevision: orderRevision(current) + 1,
            })
          : current,
        links: concludedLinks,
      });
    })
    .pipe(Effect.asVoid);

export interface SlotClaim {
  readonly expected: PublicDeviceWallet;
  readonly intent: TransferIntent;
  readonly paymentRequest: PaymentRequestId | undefined;
  readonly candidate: TransferOrder;
  readonly reconciled: boolean;
  readonly concluded: Option.Option<Settled | Failed>;
}

export const claimOrderSlot = (records: RecordsStore, claim: SlotClaim) =>
  records.updateRecords(({ wallet: current, links }) => {
    const { expected } = claim;
    const address = expected.address;

    if (current.address !== address) return Option.none();

    if (matchesIntent(current, claim.intent, claim.paymentRequest))
      return Option.none();

    const clearedObserved =
      claim.reconciled &&
      current.transfer === undefined &&
      orderRevision(current) === orderRevision(expected) + 1;

    if (!sameOrderSlot(current, expected) && !clearedObserved)
      return Option.none();

    const replaced = expected.transfer;

    return Option.some({
      wallet: new PublicDeviceWallet({
        ...current,
        transfer: claim.candidate,
        approvedUntil: undefined,
        linkReceipt: undefined,
        paymentRequest: claim.paymentRequest,
        transferRevision: orderRevision(current) + 1,
      }),
      links:
        replaced === undefined
          ? links
          : Option.match(claim.concluded, {
              onNone: () => links,
              onSome: (outcome) =>
                concludedLink(links, address, replaced, outcome),
            }),
    });
  });
