import { createServerFn } from "@tanstack/react-start";
import {
  AccountAddress,
  ActivityCursor,
  ActivityStep,
  AssetOrder,
  AssetOrderId,
  AssetStep,
  Approval,
  Approvals,
  BackupEnrollment,
  EnrollStep,
  EnrollmentChallengeStep,
  ExternalLinkOrder,
  ExternalLinkStep,
  HumanCheckToken,
  PasskeyAssertion,
  PasskeyChallenge,
  RestoreStep,
  SessionStep,
  OpenStep,
  Overview,
  PaymentLinkReceipt,
  PaymentLinkStep,
  PaymentLinksStep,
  PayoutClaimStep,
  PayoutOrder,
  PayoutQuoteStep,
  PayoutStep,
  ResolveReceiptStep,
  TransferOrder,
  TransferStep,
  WalletClaim,
  type WalletPort,
} from "@workspace/wallet";
import { Principal, Wallet } from "@workspace/wallet/server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { answerWallet, publicly, speakingFor } from "../server/wallet.server";
import { accepted, reach } from "./reach";
import { takeHumanCheck } from "./human-check";

const OverviewCall = Schema.Struct({ address: AccountAddress });

const OpenCall = Schema.Struct({
  claim: WalletClaim,
  approvals: Schema.OptionFromNullOr(Approvals),
  humanCheck: Schema.OptionFromNullOr(HumanCheckToken),
});

const TransferCall = Schema.Struct({
  order: TransferOrder,
  approval: Schema.OptionFromNullOr(Approval),
});

const ManageCall = Schema.Struct({
  order: AssetOrder,
  approval: Schema.OptionFromNullOr(Approval),
});

const PaymentLinksCall = Schema.Struct({ address: AccountAddress });

const ActivityCall = Schema.Struct({
  address: AccountAddress,
  before: Schema.optional(ActivityCursor),
});

const PaymentLinkCall = Schema.Struct({ link: AccountAddress });

const ClaimPaymentLinkCall = Schema.Struct({
  order: ExternalLinkOrder,
  approval: Schema.OptionFromNullOr(Approval),
});

const ResolvePaymentLinkCall = Schema.Struct({
  sender: AccountAddress,
  receipt: PaymentLinkReceipt,
});

const QuotePayoutCall = Schema.Struct({ link: AccountAddress });

const RequestPayoutCall = Schema.Struct({
  order: PayoutOrder,
  approval: Schema.OptionFromNullOr(Approval),
});

const PayoutCall = Schema.Struct({ id: AssetOrderId });

const RestoreChallengeCall = Schema.Struct({});

const EnrollmentChallengeCall = Schema.Struct({
  claim: WalletClaim,
  humanCheck: Schema.OptionFromNullOr(HumanCheckToken),
});

const EnrollCall = Schema.Struct({
  enrollment: BackupEnrollment,
  approvals: Approvals,
});

const RestoreCall = Schema.Struct({ assertion: PasskeyAssertion });

const SessionChallengeCall = Schema.Struct({});

const BeginSessionCall = Schema.Struct({ assertion: PasskeyAssertion });

const overviewFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof OverviewCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(OverviewCall, data, Overview, (decoded) =>
      speakingFor(
        decoded.address,
        Wallet.use((wallet) => wallet.overview(decoded.address)),
      ),
    ),
  );

const openFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof OpenCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(OpenCall, data, OpenStep, (decoded) =>
      publicly(
        Wallet.use((wallet) =>
          wallet.open(decoded.claim, decoded.approvals, decoded.humanCheck),
        ),
      ),
    ),
  );

const transferFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof TransferCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(TransferCall, data, TransferStep, (decoded) =>
      speakingFor(
        decoded.order.from,
        Wallet.use((wallet) =>
          wallet.transfer(decoded.order, decoded.approval),
        ),
      ),
    ),
  );

const manageFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof ManageCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(ManageCall, data, AssetStep, (decoded) =>
      Principal.use((principal) =>
        principal.admitsDrafting(decoded.order, decoded.approval),
      ).pipe(
        Effect.andThen(
          Wallet.use((wallet) =>
            wallet.manage(decoded.order, decoded.approval),
          ),
        ),
      ),
    ),
  );

const paymentLinksFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof PaymentLinksCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(PaymentLinksCall, data, PaymentLinksStep, (decoded) =>
      speakingFor(
        decoded.address,
        Wallet.use((wallet) => wallet.paymentLinks(decoded.address)),
      ),
    ),
  );

const activityFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof ActivityCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(ActivityCall, data, ActivityStep, (decoded) =>
      speakingFor(
        decoded.address,
        Wallet.use((wallet) =>
          wallet.activity(decoded.address, decoded.before),
        ),
      ),
    ),
  );

const paymentLinkFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof PaymentLinkCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(PaymentLinkCall, data, PaymentLinkStep, (decoded) =>
      publicly(Wallet.use((wallet) => wallet.paymentLink(decoded.link))),
    ),
  );

const claimPaymentLinkFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof ClaimPaymentLinkCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(ClaimPaymentLinkCall, data, ExternalLinkStep, (decoded) =>
      publicly(
        Wallet.use((wallet) =>
          wallet.claimPaymentLink(decoded.order, decoded.approval),
        ),
      ),
    ),
  );

const quotePayoutFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof QuotePayoutCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(QuotePayoutCall, data, PayoutQuoteStep, (decoded) =>
      publicly(Wallet.use((wallet) => wallet.quotePayout(decoded.link))),
    ),
  );

const requestPayoutFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof RequestPayoutCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(RequestPayoutCall, data, PayoutClaimStep, (decoded) =>
      publicly(
        Wallet.use((wallet) =>
          wallet.requestPayout(decoded.order, decoded.approval),
        ),
      ),
    ),
  );

const payoutFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof PayoutCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(PayoutCall, data, PayoutStep, (decoded) =>
      publicly(Wallet.use((wallet) => wallet.payout(decoded.id))),
    ),
  );

const resolvePaymentLinkFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof ResolvePaymentLinkCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(ResolvePaymentLinkCall, data, ResolveReceiptStep, (decoded) =>
      speakingFor(
        decoded.sender,
        Wallet.use((wallet) =>
          wallet.resolvePaymentLink(decoded.sender, decoded.receipt),
        ),
      ),
    ),
  );

const restoreChallengeFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof RestoreChallengeCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(RestoreChallengeCall, data, PasskeyChallenge, () =>
      publicly(Wallet.use((wallet) => wallet.restoreChallenge())),
    ),
  );

const enrollmentChallengeFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof EnrollmentChallengeCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(
      EnrollmentChallengeCall,
      data,
      EnrollmentChallengeStep,
      (decoded) =>
        publicly(
          Wallet.use((wallet) =>
            wallet.enrollmentChallenge(decoded.claim, decoded.humanCheck),
          ),
        ),
    ),
  );

const enrollFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof EnrollCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(EnrollCall, data, EnrollStep, (decoded) =>
      publicly(
        Wallet.use((wallet) =>
          wallet.enroll(decoded.enrollment, decoded.approvals),
        ),
      ),
    ),
  );

const restoreFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof RestoreCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(RestoreCall, data, RestoreStep, (decoded) =>
      publicly(Wallet.use((wallet) => wallet.restore(decoded.assertion))),
    ),
  );

const sessionChallengeFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof SessionChallengeCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(SessionChallengeCall, data, PasskeyChallenge, () =>
      publicly(Wallet.use((wallet) => wallet.sessionChallenge())),
    ),
  );

const beginSessionFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof BeginSessionCall.Encoded>())
  .handler(({ data }) =>
    answerWallet(BeginSessionCall, data, SessionStep, (decoded) =>
      publicly(Wallet.use((wallet) => wallet.beginSession(decoded.assertion))),
    ),
  );

export const port: WalletPort = {
  restoreChallenge: () =>
    reach(PasskeyChallenge, RestoreChallengeCall, {}, restoreChallengeFn),
  enrollmentChallenge: (claim) =>
    Effect.promise(takeHumanCheck).pipe(
      Effect.flatMap((humanCheck) =>
        reach(
          EnrollmentChallengeStep,
          EnrollmentChallengeCall,
          { claim, humanCheck },
          enrollmentChallengeFn,
        ),
      ),
    ),
  enroll: (enrollment, approvals) =>
    reach(EnrollStep, EnrollCall, { enrollment, approvals }, enrollFn),
  restore: (assertion) =>
    reach(RestoreStep, RestoreCall, { assertion }, restoreFn),
  sessionChallenge: () =>
    reach(PasskeyChallenge, SessionChallengeCall, {}, sessionChallengeFn),
  beginSession: (assertion) =>
    reach(SessionStep, BeginSessionCall, { assertion }, beginSessionFn),
  manage: (order, approval) =>
    reach(AssetStep, ManageCall, { order, approval }, manageFn),
  paymentLinks: (address) =>
    reach(PaymentLinksStep, PaymentLinksCall, { address }, paymentLinksFn),
  activity: (address, before) =>
    reach(ActivityStep, ActivityCall, { address, before }, activityFn),
  paymentLink: (link) =>
    reach(PaymentLinkStep, PaymentLinkCall, { link }, paymentLinkFn),
  claimPaymentLink: (order, approval) =>
    reach(
      ExternalLinkStep,
      ClaimPaymentLinkCall,
      { order, approval },
      claimPaymentLinkFn,
    ),
  quotePayout: (link) =>
    reach(PayoutQuoteStep, QuotePayoutCall, { link }, quotePayoutFn),
  requestPayout: (order, approval) =>
    reach(
      PayoutClaimStep,
      RequestPayoutCall,
      { order, approval },
      requestPayoutFn,
    ),
  payout: (id) => reach(PayoutStep, PayoutCall, { id }, payoutFn),
  resolvePaymentLink: (sender, receipt) =>
    reach(
      ResolveReceiptStep,
      ResolvePaymentLinkCall,
      { sender, receipt },
      resolvePaymentLinkFn,
    ),
  overview: (address) => reach(Overview, OverviewCall, { address }, overviewFn),
  open: (claim, approvals) =>
    Effect.promise(() =>
      Option.isSome(approvals)
        ? takeHumanCheck()
        : Promise.resolve(Option.none<HumanCheckToken>()),
    ).pipe(
      Effect.flatMap((humanCheck) =>
        reach(OpenStep, OpenCall, { claim, approvals, humanCheck }, openFn),
      ),
    ),
  transfer: (order, approval) =>
    reach(TransferStep, TransferCall, { order, approval }, transferFn),
};
