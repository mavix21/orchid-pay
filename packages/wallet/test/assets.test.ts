import { expect, layer } from "@effect/vitest";
import { Claimant, Keypair } from "@stellar/stellar-sdk";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AssetOrder,
  AddressRecipient,
  AssetUnsupported,
  baseAsset,
  ClaimUnclaimedFunds,
  CloseTrustline,
  InsufficientBalance,
  OpenTrustline,
  PositiveAmount,
  RecipientCannotReceive,
  TransferOrder,
  Username,
  UsernameRecipient,
} from "../src/contract";
import { readEnvelope } from "../src/stellar/envelopes";
import { assertTagged } from "./tagged";
import {
  addressOf,
  amount,
  approve,
  euro,
  euroLine,
  fundHolder,
  fundedWallet,
  holdingsFor,
  orderFor,
  send,
  settleHash,
  sweep,
  useDisposableDatabase,
  walletTestLayer,
  world,
  recordClaimableBalance,
  assetOrder,
  manage,
} from "./stellar-harness";
import { lumens } from "../src/stellar/assets";

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "sponsored trustline approval survives submit failure and sweep records settlement",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet("assetowner");
          const opening = assetOrder(key, OpenTrustline.make({ asset: euro }));
          const draft = yield* manage(opening);

          assertTagged(draft, "AssetDraft");
          expect(
            Option.getOrThrow(readEnvelope(draft.request.envelope))._tag,
          ).toBe("TrustlineFacts");

          world.failSubmit = true;
          expect(
            (yield* manage(opening, approve(draft.request, key)))._tag,
          ).toBe("AssetPending");
          expect(
            (yield* manage(
              assetOrder(key, OpenTrustline.make({ asset: euro })),
            ))._tag,
          ).toBe("AssetBusy");

          world.failSubmit = false;
          yield* sweep;
          const submitted = world.submitted.at(-1);

          if (!submitted) throw new Error("Expected submission");

          settleHash(submitted.hash);
          yield* sweep;

          const settled = yield* manage(opening);

          assertTagged(settled, "AssetSettled");
          expect(settled.id).toBe(opening.id);
        }),
    );

    it.effect(
      "missing recipient trustline uses a sponsored claimable and claim opens the line atomically",
      () =>
        Effect.gen(function* () {
          const sender = yield* fundedWallet("assetsender");
          const recipient = yield* fundedWallet("assetrecipient");
          const senderAddr = addressOf(sender);

          world.holdings.set(
            senderAddr,
            holdingsFor(senderAddr, { lines: [euroLine("50000000")] }),
          );

          const payment = new TransferOrder({
            ...orderFor(
              sender,
              UsernameRecipient.make({
                value: Schema.decodeSync(Username)("assetrecipient"),
              }),
            ),
            asset: euro,
          });

          const draft = yield* send(payment);

          assertTagged(draft, "TransferDraft");

          const facts = Option.getOrThrow(readEnvelope(draft.request.envelope));

          assertTagged(facts, "ClaimableFacts");
          expect(
            (yield* send(payment, approve(draft.request, sender)))._tag,
          ).toBe("Pending");
          yield* sweep;

          recordClaimableBalance({
            unclaimedFunds: facts.unclaimedFunds,
            asset: euro,
            amount: Schema.decodeSync(PositiveAmount)("10000000"),
            sponsored: true,
            claimants: [
              new Claimant(
                addressOf(recipient),
                Claimant.predicateUnconditional(),
              ),
            ],
          });

          const claimOrder = assetOrder(
            recipient,
            ClaimUnclaimedFunds.make({ unclaimedFunds: facts.unclaimedFunds }),
          );

          const claimDraft = yield* manage(claimOrder);

          assertTagged(claimDraft, "AssetDraft");

          const claimed = Option.getOrThrow(
            readEnvelope(claimDraft.request.envelope),
          );

          assertTagged(claimed, "ClaimFacts");
          expect(claimed.opens).toEqual(euro);
          expect(
            (yield* manage(claimOrder, approve(claimDraft.request, recipient)))
              ._tag,
          ).toBe("AssetPending");
        }),
    );

    it.effect(
      "a payment above the destination's incoming capacity is refused before drafting",
      () =>
        Effect.gen(function* () {
          const sender = yield* fundedWallet("capacitysender");
          const destinationKey = Keypair.random();
          const destination = addressOf(destinationKey);

          fundHolder(destinationKey);

          const order = orderFor(
            sender,
            AddressRecipient.make({ value: destination }),
          );

          const holdingWithCapacity = (capacity: string) =>
            holdingsFor(destination, {
              lines: [
                {
                  ...euroLine("0"),
                  asset: baseAsset,
                  capacity: amount(capacity),
                },
              ],
            });

          world.holdings.set(destination, holdingWithCapacity("9999999"));
          expect(yield* send(order)).toEqual(
            new RecipientCannotReceive({
              address: destination,
              reason: "no_capacity",
              linkable: false,
            }),
          );

          world.holdings.set(destination, holdingWithCapacity("10000000"));
          assertTagged(yield* send(order), "TransferDraft");
        }),
    );

    it.effect(
      "an inconsistent asset is refused and never stored, and a trustline order for XLM does not decode",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet("relabeller");
          const destinationKey = Keypair.random();
          const relabelled = { ...baseAsset, code: euro.code };

          fundHolder(destinationKey);

          const order = orderFor(
            key,
            AddressRecipient.make({ value: addressOf(destinationKey) }),
          );

          const unsupported = new AssetUnsupported({
            reason: "issuer_missing",
          });

          expect(
            yield* send(new TransferOrder({ ...order, asset: relabelled })),
          ).toEqual(unsupported);

          assertTagged(yield* send(order), "TransferDraft");

          expect(
            yield* manage(
              assetOrder(key, OpenTrustline.make({ asset: relabelled })),
            ),
          ).toEqual(unsupported);

          const opening = Schema.encodeSync(AssetOrder)(
            assetOrder(key, OpenTrustline.make({ asset: euro })),
          );

          expect(
            Schema.decodeUnknownOption(AssetOrder)({
              ...opening,
              action: { ...opening.action, asset: lumens },
            }),
          ).toEqual(Option.none());
        }),
    );

    it.effect(
      "native sends spend only available XLM and empty trustline removal stays holder signed",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet("nativeowner");
          const addr = addressOf(key);

          world.holdings.set(
            addr,
            holdingsFor(addr, {
              native: amount("5000000"),
              lines: [euroLine("0")],
            }),
          );

          const native = new TransferOrder({
            ...orderFor(
              key,
              UsernameRecipient.make({
                value: Schema.decodeSync(Username)("nativeowner"),
              }),
            ),
            asset: lumens,
          });

          expect(yield* send(native)).toEqual(
            new InsufficientBalance({ available: amount("5000000") }),
          );

          world.holdings.set(
            addr,
            holdingsFor(addr, {
              native: amount("50000000"),
              lines: [euroLine("0")],
            }),
          );

          const draft = yield* send(native);

          assertTagged(draft, "TransferDraft");
          expect(
            Option.getOrThrow(readEnvelope(draft.request.envelope)),
          ).toMatchObject({ asset: lumens });

          const close = assetOrder(key, CloseTrustline.make({ asset: euro }));
          const removal = yield* manage(close);

          assertTagged(removal, "AssetDraft");
          expect(
            (yield* manage(close, approve(removal.request, Keypair.random())))
              ._tag,
          ).toBe("AssetDraft");
          expect(
            (yield* manage(close, approve(removal.request, key)))._tag,
          ).toBe("AssetPending");
        }),
    );
  },
);
