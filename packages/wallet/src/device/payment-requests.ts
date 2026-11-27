import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  type ActivityCursor,
  type CancelPaymentRequestStep,
  type CreatePaymentRequestStep,
  type NewPaymentRequest,
  type OpenPaymentRequestsStep,
  PaymentRequestId,
  type PaymentRequestOpen,
  type PaymentRequestPort,
  type RequestPaymentsPort,
  type TransferId,
  TransferIntent,
  UsernameRecipient,
  type WalletPort,
  type WalletUnavailable,
  paymentRequestIdAlphabet,
  paymentRequestIdLength,
} from "../contract";
import type { KeyStore, KeyStoreUnavailable, SealedDevice } from "./key-store";
import {
  type ActivityOutcome,
  type ConfirmRequestPaymentOutcome,
  NoWallet,
  type PaymentReview,
  type ResumeRequestPaymentOutcome,
  type ReviewRequestPaymentOutcome,
  UnsupportedDevice,
} from "./outcomes";
import { loadFromServer } from "./reaching";

const byteValues = 256;

const unbiasedByteLimit =
  byteValues - (byteValues % paymentRequestIdAlphabet.length);

export function newPaymentRequestId(): PaymentRequestId {
  let drawn = "";

  while (drawn.length < paymentRequestIdLength)
    for (const byte of crypto.getRandomValues(
      new Uint8Array(paymentRequestIdLength - drawn.length),
    ))
      if (byte < unbiasedByteLimit)
        drawn += paymentRequestIdAlphabet.charAt(
          byte % paymentRequestIdAlphabet.length,
        );

  return Schema.decodeSync(PaymentRequestId)(drawn);
}

type DeviceRefusal = NoWallet | UnsupportedDevice | WalletUnavailable;

export type CreatePaymentRequestOutcome =
  | CreatePaymentRequestStep
  | DeviceRefusal;

export type OpenPaymentRequestsOutcome =
  | OpenPaymentRequestsStep
  | DeviceRefusal;

export type CancelPaymentRequestOutcome =
  | CancelPaymentRequestStep
  | DeviceRefusal;

export interface PaymentRequestEffects {
  create(
    request: NewPaymentRequest,
  ): Effect.Effect<CreatePaymentRequestOutcome>;
  open(): Effect.Effect<OpenPaymentRequestsOutcome>;
  cancel(id: PaymentRequestId): Effect.Effect<CancelPaymentRequestOutcome>;
  activity(before?: ActivityCursor): Effect.Effect<ActivityOutcome>;
}

const settled = <A>(
  program: Effect.Effect<A, KeyStoreUnavailable | WalletUnavailable>,
) =>
  program.pipe(
    Effect.catchTag("KeyStoreUnavailable", () =>
      Effect.succeed(new UnsupportedDevice()),
    ),
    Effect.catch((failure) => Effect.succeed(failure)),
  );

export function makePaymentRequestEffects(
  port: PaymentRequestPort & Pick<RequestPaymentsPort, "activity">,
  keyStore: KeyStore,
): PaymentRequestEffects {
  const asRequester = <A>(
    ask: (address: AccountAddress) => Effect.Effect<A, WalletUnavailable>,
  ) =>
    settled(
      Effect.gen(function* () {
        const saved = yield* keyStore.readPublic();

        if (Option.isNone(saved)) return new NoWallet();

        return yield* ask(saved.value.address);
      }),
    );

  return {
    create: (request) =>
      asRequester((address) => port.create(address, request)),
    open: () => asRequester((address) => port.open(address)),
    cancel: (id) => asRequester((address) => port.cancel(address, id)),
    activity: (before) =>
      asRequester((address) => port.activity(address, before)),
  };
}

export interface RequestPaymentEffects {
  review(
    request: PaymentRequestOpen,
  ): Effect.Effect<ReviewRequestPaymentOutcome>;
  confirm(
    id: PaymentRequestId,
    shown: PaymentReview,
  ): Effect.Effect<ConfirmRequestPaymentOutcome>;
  resume(
    id: PaymentRequestId,
    transfer: TransferId,
  ): Effect.Effect<ResumeRequestPaymentOutcome>;
}

export function makeRequestPaymentEffects(
  wallet: WalletPort,
  payments: Pick<RequestPaymentsPort, "pay">,
  store: KeyStore,
  device?: SealedDevice,
): RequestPaymentEffects {
  const reviews = { issued: Ref.makeUnsafe(Option.none<string>()), device };

  const paying = (id: PaymentRequestId) =>
    loadFromServer(() => import("./request-paying")).pipe(
      Effect.map(({ requestTransfer }) =>
        requestTransfer(wallet, payments, id, store, reviews),
      ),
    );

  return {
    review: (request) =>
      settled(
        Effect.flatMap(paying(request.id), ({ review }) =>
          review(
            new TransferIntent({
              to: UsernameRecipient.make({ value: request.requester }),
              asset: request.asset,
              amount: request.amount,
            }),
          ),
        ),
      ),
    confirm: (id, shown) =>
      settled(
        Effect.flatMap(paying(id), ({ confirm }) => confirm(shown)).pipe(
          Effect.catchTag("CorruptDeviceWallet", (damaged) =>
            Effect.succeed(damaged),
          ),
        ),
      ),
    resume: (id, transfer) =>
      settled(Effect.flatMap(paying(id), ({ resume }) => resume(transfer))),
  };
}
