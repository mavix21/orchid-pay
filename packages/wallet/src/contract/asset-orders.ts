import * as Schema from "effect/Schema";
import { SigningRequest } from "./approval";
import { UnclaimedFundsId } from "./unclaimed-funds";
import { AccountAddress } from "./identity";

export const AssetOrderId = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("AssetOrderId"),
);

export type AssetOrderId = typeof AssetOrderId.Type;

export const ClaimUnclaimedFunds = Schema.TaggedStruct("ClaimUnclaimedFunds", {
  unclaimedFunds: UnclaimedFundsId,
});

export const ReceiveLink = Schema.TaggedStruct("ReceiveLink", {
  link: AccountAddress,
  unclaimedFunds: UnclaimedFundsId,
});

export const AssetAction = Schema.Union([ClaimUnclaimedFunds, ReceiveLink]);

export type AssetAction = typeof AssetAction.Type;

export class AssetOrder extends Schema.Class<AssetOrder>(
  "@workspace/wallet/AssetOrder",
)({
  id: AssetOrderId,
  wallet: AccountAddress,
  action: AssetAction,
}) {}

const assetOrderFields = {
  id: AssetOrderId,
  action: AssetAction,
};

export class AssetDraft extends Schema.TaggedClass<AssetDraft>()("AssetDraft", {
  request: SigningRequest,
}) {}

export class AssetPending extends Schema.TaggedClass<AssetPending>()(
  "AssetPending",
  {
    ...assetOrderFields,
    expiresAt: Schema.DateTimeUtcFromString,
  },
) {}

export class AssetSettled extends Schema.TaggedClass<AssetSettled>()(
  "AssetSettled",
  {
    ...assetOrderFields,
    settledAt: Schema.DateTimeUtcFromString,
  },
) {}

export class AssetFailed extends Schema.TaggedClass<AssetFailed>()(
  "AssetFailed",
  {
    ...assetOrderFields,
    reason: Schema.Literals(["expired", "rejected"]),
  },
) {}

export class AssetBusy extends Schema.TaggedClass<AssetBusy>()("AssetBusy", {
  inFlight: AssetPending,
}) {}

export class AssetUnsupported extends Schema.TaggedClass<AssetUnsupported>()(
  "AssetUnsupported",
  {
    reason: Schema.Literals(["issuer_missing"]),
  },
) {}

export class NotClaimable extends Schema.TaggedClass<NotClaimable>()(
  "NotClaimable",
  { claimableAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString) },
) {}

export class LinkUnclaimable extends Schema.TaggedClass<LinkUnclaimable>()(
  "LinkUnclaimable",
  {
    reason: Schema.Literals(["link_account_unexpected", "destination_is_link"]),
  },
) {}

export const UnclaimedFundsGoneStatus = Schema.Literals([
  "reclaimed",
  "claimed",
  "clawed_back",
  "unresolved",
]);

export type UnclaimedFundsGoneStatus = typeof UnclaimedFundsGoneStatus.Type;

export class UnclaimedFundsGone extends Schema.TaggedClass<UnclaimedFundsGone>()(
  "UnclaimedFundsGone",
  {
    status: UnclaimedFundsGoneStatus,
  },
) {}
