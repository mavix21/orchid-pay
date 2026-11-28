import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  Amount,
  type AddressRecipient,
  type AssessmentStep,
  AssetUnsupported,
  type CheckedRecipient,
  type DestinationAddress,
  ExternalRecipient,
  InsufficientBalance,
  InvalidAddress,
  LinkRecipient,
  NotOpened,
  PhoneNotSupported,
  type Profile,
  type Receipt,
  RecipientCheck,
  type Recipient,
  type RecipientStep,
  type ResolvedRecipient,
  SenderBusy,
  TransferAssessment,
  UnknownRecipient,
  type UsernameRecipient,
  sameAsset,
} from "../contract";
import { Chain, type ChainUnreachable, MemoRule } from "./Chain.server";
import { type QuotaCheck, claimableQuotaFlow } from "./claimable-quota.server";
import {
  Directory,
  type StoreFailure,
  type WalletRow,
} from "./Directory.server";
import { memoRefusal } from "./memo-refusal.server";
import { type Authorized, Transfers, pending } from "./Transfers.server";
import {
  type DeliveryRoute,
  type TransferTerms,
  deliveryFlow,
  isDeliveryRoute,
} from "./wallet-delivery.server";

export class Examined extends Data.TaggedClass("Examined")<{
  readonly recipient: ResolvedRecipient;
  readonly requirement: MemoRule;
  readonly delivery: DeliveryRoute;
}> {}

export interface TransferEffects {
  readonly settle: (
    held: Authorized,
  ) => Effect.Effect<Receipt, StoreFailure | ChainUnreachable>;
  readonly recover: (sender: WalletRow) => Effect.Effect<void, StoreFailure>;
  readonly quota: QuotaCheck;
}

export const transferCheckFlow = Effect.gen(function* () {
  const chain = yield* Chain;
  const directory = yield* Directory;
  const transfers = yield* Transfers;
  const { route } = yield* deliveryFlow;
  const { quotaReached } = yield* claimableQuotaFlow;

  const observing: TransferEffects = {
    settle: (held) => Effect.succeed(pending(held)),
    recover: () => Effect.void,
    quota: quotaReached,
  };

  const malformed = (
    terms: TransferTerms,
  ): Option.Option<InvalidAddress | AssetUnsupported | PhoneNotSupported> => {
    if (!chain.validAddress(terms.from))
      return Option.some(new InvalidAddress({ address: terms.from }));

    if (!chain.validAsset(terms.asset))
      return Option.some(new AssetUnsupported({ reason: "issuer_missing" }));

    const invalidRecipient = Match.valueTags(terms.to, {
      Address: ({ value }) =>
        chain.validAddress(value)
          ? Option.none<DestinationAddress>()
          : Option.some(value),
      PaymentLink: ({ value }) =>
        chain.validAddress(value) && value !== terms.from
          ? Option.none<DestinationAddress>()
          : Option.some(value),
      Username: () => Option.none<DestinationAddress>(),
      Phone: () => Option.none<DestinationAddress>(),
    });

    if (Option.isSome(invalidRecipient))
      return Option.some(
        new InvalidAddress({ address: invalidRecipient.value }),
      );

    return Match.valueTags(terms.to, {
      Phone: () => Option.some(new PhoneNotSupported()),
      Username: () => Option.none(),
      Address: () => Option.none(),
      PaymentLink: () => Option.none(),
    });
  };

  const memoRequirement = Effect.fn("Wallet.memoRequirement")(function* (
    recipient: ResolvedRecipient,
  ) {
    return recipient instanceof ExternalRecipient
      ? yield* chain.memoRule(recipient.address)
      : MemoRule.MemoForbidden();
  });

  const memoDemand = (rule: MemoRule) => {
    const required = MemoRule.$is("MemoRequired")(rule)
      ? Option.some(rule)
      : Option.none();

    return {
      memoRequired: Option.isSome(required),
      exchange: Option.map(required, ({ exchange }) => exchange),
    };
  };

  const resolveContact = (
    to: typeof UsernameRecipient.Type | typeof AddressRecipient.Type,
  ) =>
    Match.valueTags(to, {
      Username: ({ value }) =>
        directory
          .byUsername(value)
          .pipe(
            Effect.map((found): Profile | UnknownRecipient =>
              Option.isSome(found)
                ? found.value
                : new UnknownRecipient({ username: value }),
            ),
          ),
      Address: ({ value }) =>
        Schema.is(AccountAddress)(value)
          ? directory
              .byAddress(value)
              .pipe(
                Effect.flatMap(
                  (
                    found,
                  ): Effect.Effect<Profile | ExternalRecipient, StoreFailure> =>
                    Option.isSome(found) && found.value.status === "active"
                      ? directory.profile(found.value)
                      : Effect.succeed(
                          new ExternalRecipient({ address: value }),
                        ),
                ),
              )
          : Effect.succeed<Profile | ExternalRecipient>(
              new ExternalRecipient({ address: value }),
            ),
    });

  const resolveRecipient = (to: Recipient) =>
    Match.valueTags(to, {
      Username: resolveContact,
      Address: resolveContact,
      PaymentLink: ({ value }) =>
        Effect.succeed<ResolvedRecipient>(
          new LinkRecipient({ kind: "paymentLink", address: value }),
        ),
      Phone: () => Effect.die("Phone was rejected before recipient resolution"),
    });

  const examine = Effect.fn("Wallet.examineTransfer")(function* (
    terms: TransferTerms,
    effects: TransferEffects,
  ) {
    const sender = yield* directory.byAddress(terms.from);

    if (Option.isNone(sender) || sender.value.status !== "active")
      return new NotOpened();

    const held = yield* transfers.latestFrom(terms.from);

    if (Option.isSome(held) && Predicate.isTagged(held.value, "Authorized")) {
      const receipt = yield* effects.settle(held.value);

      if (Predicate.isTagged(receipt, "Pending"))
        return new SenderBusy({ inFlight: receipt });
    }

    const recipient = yield* resolveRecipient(terms.to);

    if (Predicate.isTagged(recipient, "UnknownRecipient")) return recipient;

    const requirement = yield* memoRequirement(recipient);
    const refusal = memoRefusal(terms, recipient, requirement);

    if (Option.isSome(refusal)) return refusal.value;

    const state = yield* chain.holdings(terms.from, [terms.asset]);

    if (Option.isNone(state)) {
      yield* effects.recover(sender.value);

      return new NotOpened();
    }

    const balance =
      state.value.lines.find(
        (line) => sameAsset(line.asset, terms.asset) && line.authorized,
      )?.spendable ?? Schema.decodeSync(Amount)("0");

    if (balance < terms.amount)
      return new InsufficientBalance({ available: balance });

    const delivery = yield* route(terms, recipient, effects.quota);

    if (!isDeliveryRoute(delivery)) return delivery;

    return new Examined({
      recipient,
      requirement,
      delivery,
    });
  });

  const assess = Effect.fn("Wallet.assessTransfer")(function* (
    terms: TransferTerms,
  ): Effect.fn.Return<AssessmentStep, StoreFailure | ChainUnreachable> {
    const refusal = malformed(terms);

    if (Option.isSome(refusal)) return refusal.value;

    const examined = yield* examine(terms, observing);

    return examined instanceof Examined
      ? new TransferAssessment({
          recipient: examined.recipient,
          ...memoDemand(examined.requirement),
        })
      : examined;
  });

  const checkRecipient = Effect.fn("Wallet.checkRecipient")(function* (
    to: CheckedRecipient,
  ): Effect.fn.Return<RecipientStep, StoreFailure | ChainUnreachable> {
    if (Predicate.isTagged(to, "Phone")) return new PhoneNotSupported();

    if (Predicate.isTagged(to, "Address") && !chain.validAddress(to.value))
      return new InvalidAddress({ address: to.value });

    const recipient = yield* resolveContact(to);

    if (Predicate.isTagged(recipient, "UnknownRecipient")) return recipient;

    const requirement = yield* memoRequirement(recipient);

    return new RecipientCheck({ recipient, ...memoDemand(requirement) });
  });

  return { malformed, memoRequirement, examine, assess, checkRecipient };
});
