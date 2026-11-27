import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  type Approval,
  ExternalRecipient,
  Holding,
  LinkRecipient,
  Offline,
  Settled,
  TransferId,
  type TransferOrder,
  type TransferStep,
  type WalletPort,
  baseAsset,
} from "../src/contract";
import type { AssertionCeremony } from "../src/device/assertion";
import {
  PasskeyFailed,
  type Passkeys,
  PaymentLinkIntent,
  PaymentReview,
  UnsupportedDevice,
  makeWalletEffects,
} from "../src/device/client";
import { type KeyStore, PublicDeviceWallet } from "../src/device/key-store";
import {
  memoryKeyStore,
  nowSeconds,
  transferDraftOf,
  unusedPort,
} from "./device-fixtures";
import {
  approvingDevice,
  installSealedWallet,
  sealedKeyStore,
} from "./sealed-wallet-fixtures";
import {
  actors,
  amount,
  memo,
  passkeys,
  payment,
  reviewed,
  toExchange,
  toPedro,
} from "./send-fixtures";
import { assertTagged } from "./tagged";

const exchangeDraft = () =>
  transferDraftOf(
    payment(),
    new ExternalRecipient({ address: actors.exchange }),
  );

const pedroDraft = () =>
  transferDraftOf(
    actors.payment({ to: actors.pedro, amount }),
    actors.pedroProfile,
  );

const receiptFields = (order: TransferOrder) => ({
  id: order.id,
  to: order.to,
  recipient: actors.pedroProfile,
  asset: order.asset,
  amount: order.amount,
});

const settledFor = (order: TransferOrder) =>
  new Settled({
    ...receiptFields(order),
    settledAt: DateTime.makeUnsafe(Date.now()),
  });

const storedWallet = Effect.map(sealedKeyStore.readPublic(), Option.getOrThrow);

const portAnswering = (
  answer: (
    order: TransferOrder,
    approval: Option.Option<Approval>,
  ) => Effect.Effect<TransferStep, Offline>,
  overview?: WalletPort["overview"],
) => {
  const approvals: Array<Option.Option<Approval>> = [];
  const orderIds: Array<string> = [];

  const transfer: WalletPort["transfer"] = (order, approval) =>
    Effect.suspend(() => {
      approvals.push(approval);
      orderIds.push(order.id);

      return answer(order, approval);
    });

  const port = overview
    ? unusedPort({ overview, transfer })
    : unusedPort({ transfer });

  return { approvals, orderIds, port };
};

const reviewingDevice = (...args: Parameters<typeof portAnswering>) => {
  const { approvals, port } = portAnswering(...args);
  const store = memoryKeyStore(Option.some(actors.wallet));

  return {
    approvals,
    store,
    client: makeWalletEffects(port, store, passkeys),
  };
};

const confirmingDevice = Effect.fn(function* (
  answer: Parameters<typeof portAnswering>[0],
  duringPrompt: Effect.Effect<void> = Effect.void,
) {
  const { approvals, orderIds, port } = portAnswering(answer);
  const { auth } = yield* installSealedWallet(actors.wallet);

  const ceremony: AssertionCeremony = {
    assert: (request) =>
      duringPrompt.pipe(Effect.andThen(auth.assertions.assert(request))),
  };

  return {
    approvals,
    orderIds,
    auth,
    client: makeWalletEffects(port, sealedKeyStore, passkeys, {
      ...approvingDevice(auth),
      ceremony,
    }),
  };
});

const markApproved = (store: KeyStore) =>
  store
    .updatePublic((current) =>
      Option.some(
        new PublicDeviceWallet({
          ...current,
          approvedUntil: nowSeconds() + 120,
        }),
      ),
    )
    .pipe(Effect.orDie);

it.live("reviews the envelope's facts without approving the draft", () =>
  Effect.gen(function* () {
    const { approvals, client } = reviewingDevice(() =>
      Effect.succeed(exchangeDraft()),
    );

    const review = yield* reviewed(client, toExchange);

    expect(review).toMatchObject({
      to: actors.exchange,
      asset: baseAsset,
      amount,
      memo,
      claimable: false,
    });
    expect(approvals.filter(Option.isSome)).toHaveLength(0);
  }),
);

it.live(
  "approves the reviewed order once under the same id after its own prompt, never on a cancelled prompt",
  () =>
    Effect.gen(function* () {
      const { approvals, orderIds, auth, client } = yield* confirmingDevice(
        (order, approval) =>
          Effect.succeed(
            Option.isSome(approval) ? settledFor(order) : pedroDraft(),
          ),
      );

      const review = yield* reviewed(client, toPedro);

      expect(review).toMatchObject({ to: actors.pedro, username: "pedro" });

      auth.cancels = true;
      expect((yield* client.confirm(review))._tag).toBe("PasskeyCancelled");
      expect((yield* storedWallet).approvedUntil).toBeUndefined();

      auth.cancels = false;
      expect(yield* client.confirm(review)).toBeInstanceOf(Settled);
      expect(approvals.filter(Option.isSome)).toHaveLength(1);
      expect(new Set(orderIds)).toEqual(new Set([review.order.id]));
    }),
);

it.live(
  "refuses a review whose draft was swapped for a payment with the same facts and another blockhash window, by copy or in place",
  () =>
    Effect.gen(function* () {
      const { approvals, client } = yield* confirmingDevice(() =>
        Effect.succeed(pedroDraft()),
      );

      const review = yield* reviewed(client, toPedro);

      const swapped = transferDraftOf(
        actors.payment({ to: actors.pedro, amount, slot: 200n }),
        actors.pedroProfile,
      );

      const copied = new PaymentReview({ ...review, draft: swapped });

      expect((yield* client.confirm(copied))._tag).toBe("DraftRejected");

      Object.assign(review.draft.request, {
        envelope: swapped.request.envelope,
      });

      expect((yield* client.confirm(review))._tag).toBe("DraftRejected");
      expect(approvals.filter(Option.isSome)).toHaveLength(0);
    }),
);

it.live(
  "refuses a confirmation whose order another tab replaced during the prompt",
  () =>
    Effect.gen(function* () {
      const replacing = makeWalletEffects(
        unusedPort({ transfer: () => Effect.succeed(exchangeDraft()) }),
        sealedKeyStore,
        passkeys,
      );

      const { approvals, client } = yield* confirmingDevice(
        () => Effect.succeed(pedroDraft()),
        replacing.review(toExchange).pipe(Effect.asVoid),
      );

      const review = yield* reviewed(client, toPedro);

      expect((yield* client.confirm(review))._tag).toBe("DraftRejected");
      expect(approvals.filter(Option.isSome)).toHaveLength(0);

      const kept = yield* storedWallet;

      expect(kept.transfer?.to).toEqual(toExchange.to);
      expect(kept.approvedUntil).toBeUndefined();
    }),
);

it.live(
  "resume ignores an unapproved draft and reports an unsubmitted approval as outstanding",
  () =>
    Effect.gen(function* () {
      const { approvals, client, store } = reviewingDevice(
        () => Effect.succeed(pedroDraft()),
        () =>
          Effect.succeed(
            new Holding({
              profile: actors.pedroProfile,
              reserveSponsor: Option.some(actors.sponsor),
              balances: [],
              unclaimedFunds: [],
              latest: Option.none(),
            }),
          ),
      );

      const review = yield* reviewed(client, toPedro);

      expect((yield* client.resume(review.order.id))._tag).toBe("NoTransfer");
      yield* markApproved(store);
      expect((yield* client.resume(review.order.id))._tag).toBe(
        "ApprovalOutstanding",
      );
      expect(approvals.filter(Option.isSome)).toHaveLength(0);
    }),
);

it.live("keeps the signed order when confirming fails offline", () =>
  Effect.gen(function* () {
    const { client } = yield* confirmingDevice((_o, approval) =>
      Option.isSome(approval)
        ? Effect.fail(new Offline())
        : Effect.succeed(pedroDraft()),
    );

    const review = yield* reviewed(client, toPedro);

    expect(yield* client.confirm(review)).toEqual(new Offline());
    const kept = yield* storedWallet;

    expect(kept.transfer?.id).toBe(review.order.id);
    expect(kept.approvedUntil).toBeDefined();
  }),
);

it.live(
  "recovers a forgotten receipt by id, misses on another id and surfaces overview failure",
  () =>
    Effect.gen(function* () {
      let settled: Option.Option<Settled> = Option.none();
      let offline = false;

      const device = reviewingDevice(
        () => Effect.succeed(pedroDraft()),
        () =>
          offline
            ? Effect.fail(new Offline())
            : Effect.succeed(
                new Holding({
                  profile: actors.pedroProfile,
                  reserveSponsor: Option.some(actors.sponsor),
                  balances: [],
                  unclaimedFunds: [],
                  latest: settled,
                }),
              ),
      );

      const review = yield* reviewed(device.client, toPedro);
      const receipt = settledFor(review.order);

      settled = Option.some(receipt);
      expect(yield* device.client.resume(review.order.id)).toEqual(receipt);
      expect(
        (yield* device.client.resume(
          Schema.decodeSync(TransferId)(crypto.randomUUID()),
        ))._tag,
      ).toBe("NoTransfer");

      offline = true;
      expect(yield* device.client.resume(review.order.id)).toEqual(
        new Offline(),
      );
    }),
);

it.live(
  "reads, reviews and resumes without secret or passkey access, and fails closed on any signature",
  () =>
    Effect.gen(function* () {
      const lockedStore = memoryKeyStore(Option.some(actors.wallet));

      const lockedPasskeys: Passkeys = {
        authenticate: () => Effect.fail(new PasskeyFailed()),
      };

      let settleResume = false;

      const { approvals, port } = portAnswering(
        (order) =>
          Effect.succeed(
            Predicate.isTagged(order.to, "PaymentLink")
              ? transferDraftOf(
                  actors.paymentLink({ to: order.to.value, amount }),
                  new LinkRecipient({
                    kind: "paymentLink",
                    address: order.to.value,
                  }),
                )
              : settleResume
                ? settledFor(order)
                : exchangeDraft(),
          ),
        () =>
          Effect.succeed(
            new Holding({
              profile: actors.pedroProfile,
              reserveSponsor: Option.some(actors.sponsor),
              balances: [],
              unclaimedFunds: [],
              latest: Option.none(),
            }),
          ),
      );

      const client = makeWalletEffects(port, lockedStore, lockedPasskeys);

      assertTagged(yield* client.overview(), "Holding");

      const linkReview = yield* client.reviewPaymentLink(
        new PaymentLinkIntent({
          asset: baseAsset,
          amount,
          saveOnDevice: false,
        }),
      );

      assertTagged(linkReview, "PaymentReview");
      expect(yield* client.confirmPaymentLink(linkReview)).toEqual(
        new UnsupportedDevice(),
      );

      const review = yield* reviewed(client, toExchange);

      expect(yield* client.confirm(review)).toEqual(new UnsupportedDevice());
      expect(
        Option.getOrThrow(yield* lockedStore.readPublic()).approvedUntil,
      ).toBeUndefined();

      yield* markApproved(lockedStore);
      expect((yield* client.resume(review.order.id))._tag).toBe(
        "ApprovalOutstanding",
      );

      settleResume = true;
      assertTagged(yield* client.resume(review.order.id), "Settled");
      expect(approvals.filter(Option.isSome)).toHaveLength(0);
    }),
);
