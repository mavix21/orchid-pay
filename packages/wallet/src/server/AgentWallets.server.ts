import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  AccountAddress,
  ActivityCursor,
  ActivityStep,
  AssessmentStep,
  CheckedRecipient,
  Overview,
  PaymentLinksStep,
  RecipientStep,
  ServerFailure,
  TransferIntent,
} from "../contract";
import { Wallet } from "./Wallet.server";

export interface AgentWallet {
  readonly overview: Effect.Effect<Overview, ServerFailure>;
  readonly paymentLinks: Effect.Effect<PaymentLinksStep, ServerFailure>;
  activity(before?: ActivityCursor): Effect.Effect<ActivityStep, ServerFailure>;
  assess(intent: TransferIntent): Effect.Effect<AssessmentStep, ServerFailure>;
  checkRecipient(
    to: CheckedRecipient,
  ): Effect.Effect<RecipientStep, ServerFailure>;
}

export class AgentWallets extends Context.Service<
  AgentWallets,
  { bind(address: AccountAddress): AgentWallet }
>()("@workspace/wallet/server/AgentWallets") {
  static readonly layer = Layer.effect(
    AgentWallets,
    Effect.gen(function* () {
      const wallet = yield* Wallet;

      return AgentWallets.of({
        bind: (address) => ({
          overview: wallet.overview(address),
          paymentLinks: wallet.paymentLinks(address),
          activity: (before) => wallet.activity(address, before),
          assess: (intent) => wallet.assess(address, intent),
          checkRecipient: wallet.checkRecipient,
        }),
      });
    }),
  );
}
