import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AssetOrder, AssetOrderId, ReceiveLink } from "../src/contract";
import { readEnvelope } from "../src/stellar/envelopes";
import { assertTagged } from "./tagged";
import {
  fundLink,
  accountState,
  addressOf,
  approve,
  fundedWallet,
  useDisposableDatabase,
  walletTestLayer,
  world,
} from "./stellar-harness";

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "a link receive redrafts a draft made before a third party funded the link account instead of sealing it",
      () =>
        Effect.gen(function* () {
          const { wallet, link, unclaimedFunds } =
            yield* fundLink("prefundedfunder");

          const recipient = yield* fundedWallet("prefundedreceiver");

          const receive = new AssetOrder({
            id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
            wallet: addressOf(recipient),
            action: ReceiveLink.make({ link: addressOf(link), unclaimedFunds }),
          });

          const created = yield* wallet.manage(receive, Option.none());

          assertTagged(created, "AssetDraft");
          world.accounts.set(addressOf(link), accountState());

          const submissionsBefore = world.submitted.length;

          const stale = yield* wallet.manage(
            receive,
            approve(created.request, link),
          );

          assertTagged(stale, "AssetDraft");
          expect(world.submitted).toHaveLength(submissionsBefore);

          const staleFacts = Option.getOrThrow(
            readEnvelope(created.request.envelope),
          );

          const redraftedFacts = Option.getOrThrow(
            readEnvelope(stale.request.envelope),
          );

          assertTagged(staleFacts, "LinkReceiveFacts");
          assertTagged(redraftedFacts, "LinkReceiveFacts");
          expect([
            staleFacts.createsLinkAccount,
            redraftedFacts.createsLinkAccount,
          ]).toEqual([true, false]);
        }),
    );
  },
);
