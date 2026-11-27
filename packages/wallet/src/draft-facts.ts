import * as Data from "effect/Data";
import type {
  AccountAddress,
  Asset,
  UnclaimedFundsId,
  DestinationAddress,
  PaymentMemo,
  PositiveAmount,
} from "./contract";

interface Expiring {
  readonly maxTime: number;
}

interface Movement extends Expiring {
  readonly from: AccountAddress;
  readonly asset: Asset;
  readonly amount: PositiveAmount;
}

interface UnclaimedMovement extends Movement {
  readonly to: AccountAddress;
  readonly reserveSponsor: AccountAddress;
  readonly unclaimedFunds: UnclaimedFundsId;
}

export type DraftFacts = Data.TaggedEnum<{
  OpeningFacts: Expiring & {
    readonly address: AccountAddress;
    readonly reserveSponsor: AccountAddress;
  };
  PaymentFacts: Movement & {
    readonly to: DestinationAddress;
    readonly memo?: PaymentMemo | undefined;
  };
  ClaimableFacts: UnclaimedMovement;
  PaymentLinkFacts: UnclaimedMovement;
  ClaimFacts: Expiring & {
    readonly address: AccountAddress;
    readonly unclaimedFunds: UnclaimedFundsId;
    readonly opens?: Asset | undefined;
    readonly reserveSponsor?: AccountAddress | undefined;
  };
  LinkReceiveFacts: Expiring & {
    readonly link: AccountAddress;
    readonly reserveSponsor: AccountAddress;
    readonly destination: DestinationAddress;
    readonly unclaimedFunds: UnclaimedFundsId;
    readonly asset: Asset;
    readonly memo?: PaymentMemo | undefined;
  };
}>;

export type PaymentFacts = Data.TaggedEnum.Value<DraftFacts, "PaymentFacts">;

export type ClaimableFacts = Data.TaggedEnum.Value<
  DraftFacts,
  "ClaimableFacts"
>;

export type PaymentLinkFacts = Data.TaggedEnum.Value<
  DraftFacts,
  "PaymentLinkFacts"
>;

export const DraftFacts = Data.taggedEnum<DraftFacts>();
