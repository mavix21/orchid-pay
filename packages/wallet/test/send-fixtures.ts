import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AddressRecipient,
  type Approval,
  ExternalRecipient,
  LinkRecipient,
  PaymentMemo,
  PositiveAmount,
  type ResolvedRecipient,
  TransferIntent,
  TransferOrder,
  type TransferStep,
  type UnsignedEnvelope,
  UsernameRecipient,
  baseAsset,
} from "../src/contract";
import { browserKeyStore } from "../src/device/browser-key-store";
import type { WalletEffects } from "../src/device/client";
import type { DeviceRecords, SealedKeyStore } from "../src/device/key-store";
import {
  type DeviceWallet,
  memoryKeyStore,
  nowSeconds,
  transferDraftOf,
  unusedPort,
} from "./device-fixtures";
import { approvingDevice, installSealedWallet } from "./sealed-wallet-fixtures";
import { SoftwareAuthenticator } from "./software-authenticator";
import { assertTagged } from "./tagged";
import { sendActors } from "./stellar-device-fixtures";

export const actors = sendActors();
export const amount = Schema.decodeSync(PositiveAmount)("10000000");

export const otherAmount = Schema.decodeSync(PositiveAmount)("20000000");

export const memo = Schema.decodeSync(PaymentMemo)({
  type: "text",
  value: "deposit",
});

export const otherMemo = Schema.decodeSync(PaymentMemo)({
  type: "id",
  value: "7",
});

export const passkeys = new SoftwareAuthenticator("http://localhost:3000")
  .passkeys;

export const toExchange = new TransferIntent({
  to: AddressRecipient.make({ value: actors.exchange }),
  asset: baseAsset,
  amount,
  memo,
});

export const toMuxed = new TransferIntent({
  to: AddressRecipient.make({ value: actors.muxed("1") }),
  asset: baseAsset,
  amount,
});

export const toPedro = new TransferIntent({
  to: UsernameRecipient.make({ value: actors.pedroProfile.username }),
  asset: baseAsset,
  amount,
});

export const payment = (
  source = actors.sender,
  lifetime = 120,
  at = nowSeconds(),
) =>
  actors.payment({ source, to: actors.exchange, amount, memo, lifetime, at });

export const claimable = (to = actors.pedro, reserveSponsor = actors.sponsor) =>
  actors.claimable({ to, amount, reserveSponsor });

const recipientOf = (order: TransferOrder) =>
  Match.valueTags(order.to, {
    Username: (): ResolvedRecipient => actors.pedroProfile,
    Address: ({ value }) => new ExternalRecipient({ address: value }),
    PaymentLink: ({ value }) =>
      new LinkRecipient({ kind: "paymentLink", address: value }),
    Phone: () => new ExternalRecipient({ address: actors.exchange }),
  });

interface Drafting {
  readonly lifetime?: number;
  readonly answer?: (
    approval: Option.Option<Approval>,
  ) => Option.Option<TransferStep>;
}

const draftingPort = (
  envelope: (at: number, order: TransferOrder) => UnsignedEnvelope,
  options: Drafting,
) => {
  const approvals: Array<Option.Option<Approval>> = [];
  const orderIds: Array<string> = [];

  const port = unusedPort({
    transfer: (order, approval) =>
      Effect.map(Clock.currentTimeMillis, (millis) => {
        const at = Math.floor(millis / 1000);

        approvals.push(approval);
        orderIds.push(order.id);

        return Option.getOrElse(
          options.answer?.(approval) ?? Option.none(),
          () =>
            transferDraftOf(
              envelope(at, order),
              recipientOf(order),
              options.lifetime ?? 120,
              at,
            ),
        );
      }),
  });

  return { approvals, orderIds, port };
};

export const memoryDrafting = (
  envelope: (at: number, order: TransferOrder) => UnsignedEnvelope,
  options: Drafting & { readonly initial?: DeviceWallet } = {},
) => {
  const { approvals, orderIds, port } = draftingPort(envelope, options);
  const store = memoryKeyStore(Option.some(options.initial ?? actors.wallet));

  return {
    approvals,
    orderIds,
    port,
    store,
  };
};

export const sealedDrafting = Effect.fn(function* (
  envelope: (at: number, order: TransferOrder) => UnsignedEnvelope,
  options: Drafting & {
    readonly initial?: DeviceWallet;
    readonly beforeReservation?: Effect.Effect<void>;
  } = {},
) {
  const { approvals, orderIds, port } = draftingPort(envelope, options);
  const { auth } = yield* installSealedWallet(options.initial ?? actors.wallet);

  let reservations = 0;

  const reserves = (
    update: (current: DeviceRecords) => Option.Option<DeviceRecords>,
  ) =>
    Effect.zipWith(
      browserKeyStore.readPublic(),
      browserKeyStore.readLinks(),
      (stored, links) =>
        Option.exists(stored, (wallet) =>
          Option.exists(
            update({ wallet, links }),
            (next) =>
              wallet.approvedUntil === undefined &&
              next.wallet.approvedUntil !== undefined,
          ),
        ),
    );

  const store: SealedKeyStore = {
    ...browserKeyStore,
    updateRecords: (update) =>
      reserves(update).pipe(
        Effect.flatMap((reserving) =>
          reserving && reservations++ === 0
            ? (options.beforeReservation ?? Effect.void)
            : Effect.void,
        ),
        Effect.andThen(browserKeyStore.updateRecords(update)),
      ),
  };

  return {
    approvals,
    orderIds,
    auth,
    port,
    device: approvingDevice(auth, store),
  };
});

export const reviewed = Effect.fn(function* (
  client: WalletEffects,
  intent: TransferIntent,
) {
  const outcome = yield* client.review(intent);

  assertTagged(outcome, "PaymentReview");

  return outcome;
});
