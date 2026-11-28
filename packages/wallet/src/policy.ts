import { chainProfile } from "./binding/profile";

export const paymentLinkQuota = 5;

export const openPaymentRequestQuota = 5;

export const reclaimDelay = 7 * 24 * 60 * 60;

export const { lifetime: draftLifetime, approvalMargin } =
  chainProfile.draftTiming;

export const sweepBatchSize = 4;

export const sweepStuckAge = 5 * 60;

export const sweepTimeBudget = 10 * 60;

export const workFirstDelay = 10;

export const workRetryCeiling = 120;

export const workSettlementGrace = 2 * 60;

export const claimableReadLimit = 50;

export const activityPageSize = 20;

export const depositFreshness = 60;

export const depositTimeBudget = 4 * 60;
