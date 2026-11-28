import { expect, layer } from "@effect/vitest";
import { Database } from "@workspace/db";
import { sql } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  NewPaymentRequest,
  PaymentRequestId,
  PaymentRequestRequesterUnavailable,
  PositiveAmount,
  RecipientCannotReceive,
  type SigningRequest,
  type TransferOrder,
  Username,
  UsernameRecipient,
  baseAsset,
} from "../src/contract";
import { Applied, Expired, Rejected, Sealed } from "../src/server/Chain.server";
import { Directory } from "../src/server/Directory.server";
import { PaymentRequests } from "../src/server/PaymentRequests.server";
import { RequestPayments } from "../src/server/RequestPayments.server";
import { Transfers } from "../src/server/Transfers.server";
import { assertTagged } from "./tagged";
import {
  accountState,
  addressOf,
  amount,
  approve,
  authorizeTransfer,
  authorizedTransfers,
  draftTransfer,
  findTransfer,
  findWallet,
  fundedWallet,
  memoryChain,
  orderFor,
  send,
  settleHash,
  sweep,
  useDisposableDatabase,
  walletTestLayer,
  world,
} from "./wallet-harness";
import { randomAddress, randomKey, type TestKey } from "./test-keys";

const requestId = (text: string) =>
  Schema.decodeSync(PaymentRequestId)(text.padStart(10, "a"));

const toMaria = UsernameRecipient.make({
  value: Schema.decodeSync(Username)("maria"),
});

const askedBy = Effect.fn(function* (requester: TestKey, name = "1") {
  const request = new NewPaymentRequest({
    id: requestId(name),
    asset: baseAsset,
    amount: Schema.decodeSync(PositiveAmount)("10000000"),
  });

  const requests = yield* PaymentRequests;

  assertTagged(
    yield* requests.create(addressOf(requester), request),
    "PaymentRequestOpen",
  );

  return request.id;
});

const parties = Effect.gen(function* () {
  const maria = yield* fundedWallet("maria");
  const rosa = yield* fundedWallet("rosa");

  return { maria, rosa, id: yield* askedBy(maria) };
});

const pay = (
  id: PaymentRequestId,
  order: TransferOrder,
  approval: ReturnType<typeof approve> = Option.none(),
) => RequestPayments.use((payments) => payments.pay(id, order, approval));

const draftPay = Effect.fn(function* (
  id: PaymentRequestId,
  order: TransferOrder,
) {
  const draft = yield* pay(id, order);

  assertTagged(draft, "TransferDraft");

  return draft;
});

const signedHash = Effect.fn(function* (order: TransferOrder) {
  const stored = Option.getOrThrow(yield* findTransfer(order.id));

  assertTagged(stored, "Authorized");

  return stored.sealed.hash;
});

const payUntilPending = Effect.fn(function* (
  payer: TestKey,
  id: PaymentRequestId,
  order: TransferOrder,
) {
  const draft = yield* draftPay(id, order);

  assertTagged(yield* pay(id, order, approve(draft.request, payer)), "Pending");

  return { draft, hash: yield* signedHash(order) };
});

const boundTo = (id: PaymentRequestId) =>
  PaymentRequests.use((requests) => requests.inspect(id)).pipe(
    Effect.map((inspected) =>
      Option.getOrThrow(inspected).binding.pipe(
        Option.map((binding) => binding.payment),
      ),
    ),
  );

const bindDraft = Effect.fn(function* (
  id: PaymentRequestId,
  order: TransferOrder,
  request: SigningRequest,
) {
  const requests = yield* PaymentRequests;

  expect(yield* requests.bind(id, order.id, request.expiresAt)).toBe(true);
});

const lapseBindings = Database.use((db) =>
  db.execute(
    sql`update payment_requests set "paymentExpiresAt" = now() - interval '1 second' where payment is not null and status = 'open'`,
  ),
);

const cancel = (requester: TestKey, id: PaymentRequestId) =>
  RequestPayments.use((payments) => payments.cancel(addressOf(requester), id));

const publicRead = (id: PaymentRequestId) =>
  RequestPayments.use((payments) => payments.read(id));

const externalWallet = (overrides?: Parameters<typeof accountState>[0]) => {
  const address = randomAddress();

  world.accounts.set(address, accountState(overrides));

  return address;
};

const payExternally = (id: PaymentRequestId, payer: AccountAddress) =>
  RequestPayments.use((payments) => payments.payExternally(id, payer));

const settleReference = (id: PaymentRequestId, settlement: Applied | Expired) =>
  Effect.map(boundTo(id), (reference) =>
    world.evidence.set(Option.getOrThrow(reference), settlement),
  );

const testLayer = RequestPayments.serviceLayer.pipe(
  Layer.provideMerge(PaymentRequests.serviceLayer),
  Layer.provideMerge(walletTestLayer),
  Layer.provideMerge(memoryChain),
);

useDisposableDatabase();

layer(testLayer, { excludeTestServices: true, concurrent: false })(
  "request payments",
  (it) => {
    it.effect(
      "a settled payment pays the request, and replaying its order answers the same",
      () =>
        Effect.gen(function* () {
          const { rosa, id } = yield* parties;
          const order = orderFor(rosa, toMaria);
          const { draft, hash } = yield* payUntilPending(rosa, id, order);

          settleHash(hash);

          const settled = yield* pay(id, order);

          assertTagged(settled, "Settled");
          assertTagged(yield* publicRead(id), "PaymentRequestPaid");
          expect(yield* boundTo(id)).toEqual(Option.some(order.id));
          expect(yield* pay(id, order)).toEqual(settled);
          expect(yield* pay(id, order, approve(draft.request, rosa))).toEqual(
            settled,
          );
        }),
    );

    it.effect("a paid or cancelled request refuses another payment", () =>
      Effect.gen(function* () {
        const { maria, rosa, id } = yield* parties;
        const paying = orderFor(rosa, toMaria);

        settleHash((yield* payUntilPending(rosa, id, paying)).hash);

        assertTagged(
          yield* pay(id, orderFor(rosa, toMaria)),
          "PaymentRequestPaid",
        );

        const withdrawn = yield* askedBy(maria, "2");

        yield* cancel(maria, withdrawn);

        const late = orderFor(rosa, toMaria);

        assertTagged(yield* pay(withdrawn, late), "PaymentRequestCancelled");
        expect(Option.isNone(yield* findTransfer(late.id))).toBe(true);
      }),
    );

    it.effect(
      "holds a request for one payer until that payment can no longer settle",
      () =>
        Effect.gen(function* () {
          const { rosa, id } = yield* parties;
          const pedro = yield* fundedWallet("pedro");
          const first = orderFor(rosa, toMaria);
          const second = orderFor(pedro, toMaria);
          const { hash } = yield* payUntilPending(rosa, id, first);

          assertTagged(yield* pay(id, second), "PaymentRequestBeingPaid");

          world.evidence.set(hash, new Rejected({ code: "txFailed" }));

          const draft = yield* draftPay(id, second);

          const unsigned = yield* pay(
            id,
            second,
            approve(draft.request, randomKey()),
          );

          assertTagged(unsigned, "TransferDraft");
          expect(yield* boundTo(id)).toEqual(Option.none());
          expect(Option.isNone(yield* findTransfer(second.id))).toBe(true);

          const abandoned = yield* draftPay(id, second);
          const stale = Option.getOrThrow(yield* findTransfer(second.id));

          assertTagged(stale, "Proposed");
          yield* bindDraft(id, second, abandoned.request);

          const third = orderFor(rosa, toMaria);

          assertTagged(yield* pay(id, third), "PaymentRequestBeingPaid");
          yield* lapseBindings;

          world.evidence.clear();

          const next = yield* draftPay(id, third);

          yield* Transfers.use((transfers) =>
            transfers.authorize(
              stale,
              new Sealed({
                envelope: stale.request.envelope,
                hash: "late",
                expiresAt: stale.request.expiresAt,
              }),
            ),
          ).pipe(Effect.flip);
          expect(yield* authorizedTransfers).toEqual([]);

          assertTagged(
            yield* pay(id, third, approve(next.request, rosa)),
            "Pending",
          );
          expect(yield* boundTo(id)).toEqual(Option.some(third.id));
        }),
    );

    it.effect(
      "a transfer made outside the request or held by another cannot pay it",
      () =>
        Effect.gen(function* () {
          const { maria, rosa, id } = yield* parties;
          const outside = orderFor(rosa, toMaria);

          const { draft, authorized } = yield* authorizeTransfer(rosa, outside);

          settleHash(authorized.sealed.hash);
          assertTagged(yield* send(outside), "Settled");

          assertTagged(yield* pay(id, outside), "PaymentRequestPaymentTaken");
          assertTagged(
            yield* pay(id, outside, approve(draft.request, rosa)),
            "PaymentRequestPaymentTaken",
          );

          const other = yield* askedBy(maria, "2");
          const shared = orderFor(rosa, toMaria);
          const proposed = yield* draftTransfer(shared);

          yield* bindDraft(other, shared, proposed.request);

          assertTagged(
            yield* pay(id, shared, approve(proposed.request, rosa)),
            "PaymentRequestPaymentTaken",
          );
          expect(yield* boundTo(id)).toEqual(Option.none());
          expect(yield* boundTo(other)).toEqual(Option.some(shared.id));
          assertTagged(yield* publicRead(id), "PaymentRequestOpen");
        }),
    );

    it.effect(
      "cannot be cancelled while a payment is bound, and cancelling reconciles an applied one",
      () =>
        Effect.gen(function* () {
          const { maria, rosa, id } = yield* parties;
          const order = orderFor(rosa, toMaria);
          const { hash } = yield* payUntilPending(rosa, id, order);

          assertTagged(yield* cancel(maria, id), "PaymentRequestBeingPaid");

          settleHash(hash);

          assertTagged(yield* cancel(maria, id), "PaymentRequestPaid");
        }),
    );

    it.effect(
      "a payment that settles after its payer left shows as paid publicly and in activity",
      () =>
        Effect.gen(function* () {
          const { maria, rosa, id } = yield* parties;
          const order = orderFor(rosa, toMaria);

          settleHash((yield* payUntilPending(rosa, id, order)).hash);
          yield* sweep;

          assertTagged(yield* publicRead(id), "PaymentRequestPaid");

          const activity = yield* RequestPayments.use((payments) =>
            payments.activity(addressOf(maria)),
          );

          assertTagged(activity, "RequestActivityPage");
          expect(activity.paidRequests).toMatchObject([
            { payment: order.id, request: { id } },
          ]);
        }),
    );

    it.effect("refuses its own requester as payer", () =>
      Effect.gen(function* () {
        const { maria, id } = yield* parties;

        assertTagged(
          yield* pay(id, orderFor(maria, toMaria)),
          "PaymentRequestSelfPay",
        );
      }),
    );

    it.effect("refuses a payment the requester cannot receive directly", () =>
      Effect.gen(function* () {
        const { maria, rosa, id } = yield* parties;
        const direct = orderFor(rosa, toMaria);

        world.accounts.set(
          addressOf(maria),
          accountState({ balance: Option.none() }),
        );
        expect(yield* pay(id, direct)).toEqual(
          new RecipientCannotReceive({
            address: addressOf(maria),
            reason: "no_account",
            linkable: true,
          }),
        );
        expect(Option.isNone(yield* findTransfer(direct.id))).toBe(true);
        expect(yield* authorizedTransfers).toEqual([]);

        world.accounts.set(addressOf(maria), accountState());

        const row = Option.getOrThrow(yield* findWallet(addressOf(maria)));

        yield* Directory.use((directory) => directory.recover(row));
        expect(yield* pay(id, orderFor(rosa, toMaria))).toEqual(
          new PaymentRequestRequesterUnavailable(),
        );
      }),
    );

    it.effect(
      "an external wallet's payment holds the request until its reference settles it",
      () =>
        Effect.gen(function* () {
          const { maria, rosa, id } = yield* parties;
          const payer = externalWallet();
          const drafted = yield* payExternally(id, payer);

          assertTagged(drafted, "PaymentRequestTransaction");
          expect(yield* payExternally(id, payer)).toEqual(drafted);
          assertTagged(
            yield* payExternally(id, externalWallet()),
            "PaymentRequestBeingPaid",
          );
          assertTagged(
            yield* pay(id, orderFor(rosa, toMaria)),
            "PaymentRequestBeingPaid",
          );
          assertTagged(yield* cancel(maria, id), "PaymentRequestBeingPaid");

          yield* settleReference(id, new Applied({ at: DateTime.nowUnsafe() }));

          assertTagged(yield* publicRead(id), "PaymentRequestPaid");
          assertTagged(yield* payExternally(id, payer), "PaymentRequestPaid");
        }),
    );

    it.effect(
      "releases an external payment only once its transaction can no longer land",
      () =>
        Effect.gen(function* () {
          const { rosa, id } = yield* parties;
          const payer = externalWallet();

          assertTagged(
            yield* payExternally(id, payer),
            "PaymentRequestTransaction",
          );

          yield* lapseBindings;

          assertTagged(yield* publicRead(id), "PaymentRequestOpen");
          expect(Option.isSome(yield* boundTo(id))).toBe(true);

          yield* settleReference(id, new Expired());

          assertTagged(yield* publicRead(id), "PaymentRequestOpen");
          expect(yield* boundTo(id)).toEqual(Option.none());

          const order = orderFor(rosa, toMaria);

          yield* payUntilPending(rosa, id, order);
          expect(yield* boundTo(id)).toEqual(Option.some(order.id));
        }),
    );

    it.effect(
      "refuses an external payment from the requester, from an unfunded wallet or to a requester who cannot receive it",
      () =>
        Effect.gen(function* () {
          const { maria, id } = yield* parties;

          assertTagged(
            yield* payExternally(id, addressOf(maria)),
            "PaymentRequestSelfPay",
          );
          assertTagged(
            yield* payExternally(
              id,
              externalWallet({ balance: Option.some(amount("9999999")) }),
            ),
            "PaymentRequestPayerUnfunded",
          );

          world.accounts.set(
            addressOf(maria),
            accountState({ balance: Option.none() }),
          );

          assertTagged(
            yield* payExternally(id, externalWallet()),
            "PaymentRequestRequesterUnavailable",
          );
          expect(yield* boundTo(id)).toEqual(Option.none());
        }),
    );
  },
);
