import type * as Data from "effect/Data";
import type * as Option from "effect/Option";
import type {
  AccountAddress,
  Asset,
  UnclaimedFundsId,
  DestinationAddress,
  PaymentMemo,
  PositiveAmount,
  SigningRequest,
} from "./contract";
import type { SigningScheme } from "./device/signing-scheme";
import { deviceNetwork } from "./binding/networks";

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
    readonly amount: PositiveAmount;
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

export interface DeviceNetwork {
  readonly network: string;
  readonly signingScheme: SigningScheme;
  readonly readDraft: (request: SigningRequest) => Option.Option<DraftFacts>;
  readonly baseAccountOf: (destination: DestinationAddress) => AccountAddress;
  readonly isIssuedBy: (asset: Asset, account: AccountAddress) => boolean;
}

export const { network, signingScheme, readDraft, baseAccountOf, isIssuedBy } =
  deviceNetwork;
