import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  type Failed,
  type Pending,
  type Settled,
  type AccountAddress,
  ActivityPage,
  type ActivityCursor,
  type Approval,
  type CancelPaymentRequestStep,
  type ExternalPaymentStep,
  type OpenPaymentRequestsStep,
  type PayPaymentRequestStep,
  PaymentRequestBeingPaid,
  type PaymentRequestId,
  PaymentRequestNotFound,
  PaymentRequestOpen,
  PaymentRequestPayerUnfunded,
  PaymentRequestPaymentTaken,
  PaymentRequestRequesterUnavailable,
  PaymentRequestSelfPay,
  PaymentRequestTransaction,
  type PaymentRequestStep,
  Profile,
  RequestActivityPage,
  type RequestActivityStep,
  type RequestPaymentsPort,
  type ServerFailure,
  TransferId,
  type TransferOrder,
  type TransferStep,
  sameAsset,
} from "../contract";
import { chainLayer } from "../binding/chain.server";
import { Chain, type ChainUnreachable } from "./Chain.server";
import { Directory } from "./Directory.server";
import {
  type ExternalBinding,
  PaymentRequests,
} from "./PaymentRequests.server";
import { Principal } from "./Principal.server";
import { StoreFailure } from "./store-failure.server";
import {
  type Authorized,
  type Concluded,
  OrderJson,
  Transfers,
  pending,
} from "./Transfers.server";
import { Wallet } from "./Wallet.server";
import { live } from "./wallet-reads.server";

type Failure = StoreFailure | ServerFailure | ChainUnreachable;

const orderJson = Schema.encodeSync(OrderJson);

const sameOrder = (stored: TransferOrder, order: TransferOrder) =>
  orderJson(stored) === orderJson(order);

const otherOrder = () =>
  new StoreFailure({
    cause: new Error("Transfer id cannot identify a different order"),
  });

const meetsTerms = (request: PaymentRequestOpen, order: TransferOrder) =>
  Predicate.isTagged(order.to, "Username") &&
  order.to.value === request.requester &&
  sameAsset(order.asset, request.asset) &&
  order.amount === request.amount &&
  order.memo === undefined;

const paidDirectly = (request: PaymentRequestOpen, concluded: Concluded) =>
  Predicate.isTagged(concluded.receipt, "Settled") &&
  concluded.receipt.unclaimedFunds === undefined &&
  meetsTerms(request, concluded.order) &&
  concluded.recipient instanceof Profile &&
  concluded.recipient.username === request.requester &&
  concluded.recipient.address !== concluded.order.from;

const receiptOf = (signed: Authorized | Concluded) =>
  Predicate.isTagged(signed, "Authorized") ? pending(signed) : signed.receipt;

const isReceipt = (step: TransferStep): step is Pending | Settled | Failed =>
  Predicate.isTagged(step, "Pending") ||
  Predicate.isTagged(step, "Settled") ||
  Predicate.isTagged(step, "Failed");

const needsUnclaimedFunds = (step: TransferStep) =>
  Predicate.isTagged(step, "UnclaimedFundsLimitReached") ||
  (Predicate.isTagged(step, "TransferDraft") &&
    step.unclaimedFunds !== undefined);

const termsOf = (request: PaymentRequestOpen, binding: ExternalBinding) => ({
  payer: binding.payer,
  requester: binding.requester,
  amount: request.amount,
  request: request.id,
});

export class RequestPayments extends Context.Service<
  RequestPayments,
  RequestPaymentsPort<Failure> & {
    payExternally(
      id: PaymentRequestId,
      payer: AccountAddress,
    ): Effect.Effect<ExternalPaymentStep, Failure>;
  }
>()("@workspace/wallet/server/RequestPayments") {
  static readonly serviceLayer = Layer.effect(
    RequestPayments,
    Effect.gen(function* () {
      const requests = yield* PaymentRequests;
      const transfers = yield* Transfers;
      const wallet = yield* Wallet;
      const directory = yield* Directory;
      const chain = yield* Chain;

      const discard = Effect.fn("RequestPayments.discard")(function* (
        id: PaymentRequestId,
        payment: TransferId,
      ) {
        const discarded = yield* transfers.discardProposed(payment);

        if (discarded) yield* requests.release(id, payment);

        return discarded;
      });

      const converge = (
        id: PaymentRequestId,
        reconciling: boolean,
      ): Effect.Effect<void, Failure> =>
        Effect.gen(function* () {
          const inspected = yield* requests.inspect(id);

          if (Option.isNone(inspected)) return;

          const { step: request, binding } = inspected.value;

          if (
            !(request instanceof PaymentRequestOpen) ||
            Option.isNone(binding)
          )
            return;

          const { external } = binding.value;

          if (Option.isSome(external)) {
            const { reference } = external.value.payment;

            const settlement = yield* chain.externalPaymentSettlement(
              external.value.payment,
              termsOf(request, external.value),
            );

            if (Predicate.isTagged(settlement, "Applied"))
              return yield* requests.markPaid(id, reference);

            if (!Predicate.isTagged(settlement, "Undecided"))
              yield* requests.release(id, reference);

            return;
          }

          const payment = Schema.decodeSync(TransferId)(binding.value.payment);
          const found = yield* transfers.find(payment);

          if (Option.isNone(found)) return yield* requests.release(id, payment);

          const stored = found.value;

          if (Predicate.isTagged(stored, "Concluded"))
            return paidDirectly(request, stored)
              ? yield* requests.markPaid(id, payment)
              : yield* requests.release(id, payment);

          if (Predicate.isTagged(stored, "Authorized")) {
            if (!reconciling) return;

            const receipt = yield* wallet.transfer(stored.order, Option.none());

            if (!Predicate.isTagged(receipt, "Pending"))
              yield* converge(id, false);

            return;
          }

          const now = yield* Clock.currentTimeMillis;

          const lapsed = Option.exists(
            binding.value.expiresAt,
            (expiresAt) => now > DateTime.toEpochMillis(expiresAt),
          );

          if (lapsed && !(yield* discard(id, payment)))
            yield* converge(id, reconciling);
        });

      const convergeOpen = Effect.fn("RequestPayments.convergeOpen")(function* (
        address: AccountAddress,
      ) {
        yield* Effect.forEach(
          yield* requests.openBound(address),
          (id) => converge(id, false),
          { discard: true },
        );
      });

      const heldAnswer = Effect.fn("RequestPayments.heldAnswer")(function* (
        id: PaymentRequestId,
        receipt: Pending | Settled | Failed,
      ) {
        if (Predicate.isTagged(receipt, "Failed")) return receipt;

        const inspected = yield* requests.inspect(id);

        const held = Option.exists(
          Option.flatMap(inspected, ({ binding }) => binding),
          ({ payment }) => payment === receipt.id,
        );

        return held ? receipt : new PaymentRequestPaymentTaken();
      });

      const withdraw = Effect.fn("RequestPayments.withdraw")(function* (
        id: PaymentRequestId,
        order: TransferOrder,
      ) {
        if (yield* discard(id, order.id)) return Option.none();

        yield* converge(id, true);

        const found = yield* transfers.find(order.id);

        if (
          Option.isNone(found) ||
          Predicate.isTagged(found.value, "Proposed") ||
          !sameOrder(found.value.order, order)
        )
          return Option.none();

        return Option.some(yield* heldAnswer(id, receiptOf(found.value)));
      });

      const refuseRequester = Effect.fn("RequestPayments.refuseRequester")(
        function* (id: PaymentRequestId, order: TransferOrder) {
          return Option.getOrElse(
            yield* withdraw(id, order),
            () => new PaymentRequestRequesterUnavailable(),
          );
        },
      );

      const drafted = Effect.fn("RequestPayments.draft")(function* (
        id: PaymentRequestId,
        order: TransferOrder,
      ) {
        const step = yield* wallet.transfer(order, Option.none());

        if (needsUnclaimedFunds(step)) return yield* refuseRequester(id, order);

        return isReceipt(step) ? yield* heldAnswer(id, step) : step;
      });

      const submitted = Effect.fn("RequestPayments.submit")(function* (
        id: PaymentRequestId,
        order: TransferOrder,
        approval: Option.Option<Approval>,
      ) {
        const step = yield* wallet.transfer(order, approval);

        if (needsUnclaimedFunds(step)) return yield* refuseRequester(id, order);

        if (isReceipt(step)) {
          yield* converge(id, false);

          return yield* heldAnswer(id, step);
        }

        return Option.getOrElse(yield* withdraw(id, order), () => step);
      });

      const notBound = Effect.fn("RequestPayments.notBound")(function* (
        id: PaymentRequestId,
      ) {
        const inspected = yield* requests.inspect(id);

        if (Option.isNone(inspected)) return new PaymentRequestNotFound();

        const { step } = inspected.value;

        return step instanceof PaymentRequestOpen
          ? new PaymentRequestBeingPaid()
          : step;
      });

      const pay = Effect.fn("RequestPayments.pay")(function* (
        id: PaymentRequestId,
        order: TransferOrder,
        approval: Option.Option<Approval>,
      ): Effect.fn.Return<PayPaymentRequestStep, Failure> {
        yield* converge(id, true);

        const inspected = yield* requests.inspect(id);

        if (Option.isNone(inspected)) return new PaymentRequestNotFound();

        const { step: request, binding } = inspected.value;
        const own = Option.exists(binding, (held) => held.payment === order.id);
        const found = yield* transfers.find(order.id);

        if (
          own &&
          Option.isSome(found) &&
          !Predicate.isTagged(found.value, "Proposed")
        ) {
          if (!sameOrder(found.value.order, order)) return yield* otherOrder();

          yield* converge(id, false);

          return yield* heldAnswer(id, receiptOf(found.value));
        }

        if (!(request instanceof PaymentRequestOpen)) return request;

        if (!meetsTerms(request, order))
          return yield* new StoreFailure({
            cause: new Error("Transfer order does not pay the payment request"),
          });

        const requester = yield* directory.byUsername(request.requester);

        if (Option.isNone(requester))
          return Option.exists(
            found,
            (stored) =>
              Predicate.isTagged(stored, "Proposed") &&
              sameOrder(stored.order, order),
          )
            ? yield* refuseRequester(id, order)
            : new PaymentRequestRequesterUnavailable();

        if (requester.value.address === order.from)
          return new PaymentRequestSelfPay();

        if (
          Option.isSome(found) &&
          !Predicate.isTagged(found.value, "Proposed")
        ) {
          const stored = found.value;

          if (
            !Predicate.isTagged(stored, "Concluded") ||
            !Predicate.isTagged(stored.receipt, "Failed")
          )
            return new PaymentRequestPaymentTaken();

          if (!sameOrder(stored.order, order)) return yield* otherOrder();

          return stored.receipt;
        }

        if (Option.isSome(binding) && !own)
          return new PaymentRequestBeingPaid();

        if (Option.isSome(found) && !sameOrder(found.value.order, order))
          return yield* otherOrder();

        if (
          Option.isNone(approval) ||
          Option.isNone(found) ||
          !Predicate.isTagged(found.value, "Proposed")
        )
          return yield* drafted(id, order);

        const proposed = found.value;

        if (proposed.unclaimedFunds !== undefined)
          return yield* refuseRequester(id, order);

        if (!(yield* live(proposed.request))) {
          const left = own ? yield* withdraw(id, order) : Option.none();

          return Option.isSome(left) ? left.value : yield* drafted(id, order);
        }

        const bound = yield* requests.bind(
          id,
          order.id,
          proposed.request.expiresAt,
        );

        if (bound instanceof PaymentRequestPaymentTaken) return bound;

        return bound
          ? yield* submitted(id, order, approval)
          : yield* notBound(id);
      });

      const read = Effect.fn("RequestPayments.read")(function* (
        id: PaymentRequestId,
      ): Effect.fn.Return<PaymentRequestStep, Failure> {
        yield* converge(id, false);

        return yield* requests.read(id);
      });

      const open = Effect.fn("RequestPayments.open")(function* (
        address: AccountAddress,
      ): Effect.fn.Return<OpenPaymentRequestsStep, Failure> {
        yield* convergeOpen(address);

        return yield* requests.open(address);
      });

      const cancel = Effect.fn("RequestPayments.cancel")(function* (
        address: AccountAddress,
        id: PaymentRequestId,
      ): Effect.fn.Return<CancelPaymentRequestStep, Failure> {
        yield* converge(id, true);

        return yield* requests.cancel(address, id);
      });

      const activity = Effect.fn("RequestPayments.activity")(function* (
        address: AccountAddress,
        before?: ActivityCursor,
      ): Effect.fn.Return<RequestActivityStep, Failure> {
        yield* convergeOpen(address);

        const page = yield* wallet.activity(address, before);

        if (!(page instanceof ActivityPage)) return page;

        const received = page.entries.flatMap((entry) =>
          Predicate.isTagged(entry, "ReceivedActivity") ? [entry.id] : [],
        );

        return new RequestActivityPage({
          page,
          paidRequests: yield* requests.paidBy(received),
        });
      });

      const payExternally = Effect.fn("RequestPayments.payExternally")(
        function* (
          id: PaymentRequestId,
          payer: AccountAddress,
        ): Effect.fn.Return<ExternalPaymentStep, Failure> {
          yield* converge(id, true);

          const inspected = yield* requests.inspect(id);

          if (Option.isNone(inspected)) return new PaymentRequestNotFound();

          const { step: request, binding } = inspected.value;

          if (!(request instanceof PaymentRequestOpen)) return request;

          if (Option.isSome(binding)) {
            const now = yield* Clock.currentTimeMillis;

            const resumable = Option.filter(
              binding.value.external,
              (held) =>
                held.payer === payer &&
                now < DateTime.toEpochMillis(held.payment.expiresAt),
            );

            return Option.match(resumable, {
              onNone: () => new PaymentRequestBeingPaid(),
              onSome: (held) =>
                new PaymentRequestTransaction({
                  request,
                  transaction: held.payment.transaction,
                }),
            });
          }

          const requester = yield* directory.byUsername(request.requester);

          if (Option.isNone(requester))
            return new PaymentRequestRequesterUnavailable();

          const { address } = requester.value;

          if (address === payer) return new PaymentRequestSelfPay();

          const blocked = yield* chain.receiveBlocker(
            address,
            request.asset,
            request.amount,
          );

          if (Option.isSome(blocked))
            return new PaymentRequestRequesterUnavailable();

          const holdings = yield* chain.holdings(payer, [request.asset]);

          const funded = Option.exists(holdings, ({ lines }) =>
            lines.some(
              (line) =>
                sameAsset(line.asset, request.asset) &&
                line.spendable >= request.amount,
            ),
          );

          if (!funded) return new PaymentRequestPayerUnfunded();

          const held: ExternalBinding = {
            payer,
            requester: address,
            payment: yield* chain.draftExternalPayment({
              payer,
              requester: address,
              amount: request.amount,
              request: request.id,
            }),
          };

          return (yield* requests.bindExternal(id, held))
            ? new PaymentRequestTransaction({
                request,
                transaction: held.payment.transaction,
              })
            : yield* notBound(id);
        },
      );

      return RequestPayments.of({
        pay,
        read,
        open,
        cancel,
        activity,
        payExternally,
      });
    }),
  );
  static readonly layer = RequestPayments.serviceLayer.pipe(
    Layer.provide([PaymentRequests.serviceLayer, Wallet.layer, chainLayer]),
    Layer.provide(Transfers.layer),
    Layer.provideMerge(Principal.layer),
    Layer.provide(Directory.layer),
  );
}
