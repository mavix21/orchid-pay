import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  AccountAddress,
  Approval,
  Asset,
  DestinationAddress,
  OpeningDraft,
  PaymentMemo,
  PositiveAmount,
  SigningRequest,
} from "../contract";
import type { AccountChain } from "./chain-accounts.server";
import type { AssetChain } from "./chain-assets.server";
import type { DepositChain } from "./chain-deposits.server";
import type { DestinationChain } from "./chain-destinations.server";
import type { DraftChain } from "./chain-drafts.server";
import type { ChainUnreachable } from "./chain-errors.server";
import type { LinkChain } from "./chain-links.server";
import type { RequestPaymentChain } from "./chain-request-payments.server";
import type { Sealed, Settlement } from "./chain-settlement.server";
import type { StoreFailure } from "./store-failure.server";

export { ChainUnreachable } from "./chain-errors.server";

export type { AccountStanding } from "./chain-accounts.server";

export { MemoRule } from "./chain-destinations.server";

export { DraftPurpose } from "./chain-drafts.server";

export type { LinkReceive } from "./chain-links.server";

export {
  ExternalPayment,
  type ExternalPaymentTerms,
} from "./chain-request-payments.server";

export {
  Applied,
  Expired,
  Rejected,
  Sealed,
  Undecided,
  type Settlement,
} from "./chain-settlement.server";

export class ApprovalInvalid extends Schema.TaggedError<ApprovalInvalid>()(
  "ApprovalInvalid",
  {},
) {}

export class SubmissionRejected extends Schema.TaggedError<SubmissionRejected>()(
  "SubmissionRejected",
  {
    code: Schema.optional(Schema.String),
  },
) {}

export class Chain extends Context.Service<
  Chain,
  AccountChain &
    AssetChain &
    DestinationChain &
    DraftChain &
    LinkChain &
    DepositChain &
    RequestPaymentChain & {
      validAddress(address: DestinationAddress): boolean;
      pastOpeningWindow(
        sealed: Sealed,
      ): Effect.Effect<boolean, ChainUnreachable>;
      draftOpening(
        address: AccountAddress,
      ): Effect.Effect<OpeningDraft, ChainUnreachable | StoreFailure>;
      draftPayment(
        from: AccountAddress,
        to: DestinationAddress,
        asset: Asset,
        amount: PositiveAmount,
        memo?: PaymentMemo,
      ): Effect.Effect<SigningRequest, ChainUnreachable>;
      seal(
        request: SigningRequest,
        approval: Approval,
        holder: AccountAddress,
      ): Effect.Effect<Sealed, ApprovalInvalid>;
      submit(
        sealed: Sealed,
      ): Effect.Effect<void, ChainUnreachable | SubmissionRejected>;
      settlement(sealed: Sealed): Effect.Effect<Settlement, ChainUnreachable>;
    }
>()("@workspace/wallet/server/Chain") {}
