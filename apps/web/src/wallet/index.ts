import {
  type WalletClient,
  type WalletEffects,
  loadFromServer,
} from "@workspace/wallet";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import { sessionLapse } from "./session-lapse";

const loaded = loadFromServer(() => import("./client")).pipe(
  Effect.map((client) => client.walletEffects),
);

const withWallet = <A>(use: (wallet: WalletEffects) => Effect.Effect<A>) =>
  loaded.pipe(
    Effect.flatMap(use),
    Effect.catch((failure) => Effect.succeed(failure)),
    Effect.tap((outcome) =>
      Effect.sync(() => {
        if (Predicate.isTagged(outcome, "SessionRequired")) sessionLapse.note();
      }),
    ),
  );

export const walletEffects: WalletEffects = {
  overview: () => withWallet((wallet) => wallet.overview()),
  saved: () => withWallet((wallet) => wallet.saved()),
  sessionChallenge: () => withWallet((wallet) => wallet.sessionChallenge()),
  confirmSession: (challenge) =>
    withWallet((wallet) => wallet.confirmSession(challenge)),
  reviewOpening: (usernameText) =>
    withWallet((wallet) => wallet.reviewOpening(usernameText)),
  confirmOpening: (shown) =>
    withWallet((wallet) => wallet.confirmOpening(shown)),
  backUp: () => withWallet((wallet) => wallet.backUp()),
  restore: () => withWallet((wallet) => wallet.restore()),
  cancelRestore: () => withWallet((wallet) => wallet.cancelRestore()),
  review: (intent) => withWallet((wallet) => wallet.review(intent)),
  confirm: (shown) => withWallet((wallet) => wallet.confirm(shown)),
  resume: (id) => withWallet((wallet) => wallet.resume(id)),
  reviewPaymentLink: (intent) =>
    withWallet((wallet) => wallet.reviewPaymentLink(intent)),
  confirmPaymentLink: (shown) =>
    withWallet((wallet) => wallet.confirmPaymentLink(shown)),
  paymentLinks: () => withWallet((wallet) => wallet.paymentLinks()),
  resolvePaymentLink: () => withWallet((wallet) => wallet.resolvePaymentLink()),
  revealPaymentLink: (target) =>
    withWallet((wallet) => wallet.revealPaymentLink(target)),
  reviewReclaim: (target) =>
    withWallet((wallet) => wallet.reviewReclaim(target)),
  confirmReclaim: (shown) =>
    withWallet((wallet) => wallet.confirmReclaim(shown)),
  paymentLink: (code) => withWallet((wallet) => wallet.paymentLink(code)),
  reviewLinkReceive: (code) =>
    withWallet((wallet) => wallet.reviewLinkReceive(code)),
  confirmLinkReceive: (shown, code) =>
    withWallet((wallet) => wallet.confirmLinkReceive(shown, code)),
  reviewExternalLinkClaim: (code, intent) =>
    withWallet((wallet) => wallet.reviewExternalLinkClaim(code, intent)),
  confirmExternalLinkClaim: (shown, code) =>
    withWallet((wallet) => wallet.confirmExternalLinkClaim(shown, code)),
  quotePayout: (code) => withWallet((wallet) => wallet.quotePayout(code)),
  reviewPayout: (code, destination, quote) =>
    withWallet((wallet) => wallet.reviewPayout(code, destination, quote)),
  confirmPayout: (shown, code) =>
    withWallet((wallet) => wallet.confirmPayout(shown, code)),
  followPayout: (id) => withWallet((wallet) => wallet.followPayout(id)),
};

export const walletClient: WalletClient = {
  overview: () => Effect.runPromise(walletEffects.overview()),
  saved: () => Effect.runPromise(walletEffects.saved()),
  sessionChallenge: () => Effect.runPromise(walletEffects.sessionChallenge()),
  confirmSession: (challenge) =>
    Effect.runPromise(walletEffects.confirmSession(challenge)),
  reviewOpening: (usernameText) =>
    Effect.runPromise(walletEffects.reviewOpening(usernameText)),
  confirmOpening: (shown) =>
    Effect.runPromise(walletEffects.confirmOpening(shown)),
  backUp: () => Effect.runPromise(walletEffects.backUp()),
  restore: () => Effect.runPromise(walletEffects.restore()),
  cancelRestore: () => Effect.runPromise(walletEffects.cancelRestore()),
  review: (intent) => Effect.runPromise(walletEffects.review(intent)),
  confirm: (shown) => Effect.runPromise(walletEffects.confirm(shown)),
  resume: (id) => Effect.runPromise(walletEffects.resume(id)),
  reviewPaymentLink: (intent) =>
    Effect.runPromise(walletEffects.reviewPaymentLink(intent)),
  confirmPaymentLink: (shown) =>
    Effect.runPromise(walletEffects.confirmPaymentLink(shown)),
  paymentLinks: () => Effect.runPromise(walletEffects.paymentLinks()),
  resolvePaymentLink: () =>
    Effect.runPromise(walletEffects.resolvePaymentLink()),
  revealPaymentLink: (target) =>
    Effect.runPromise(walletEffects.revealPaymentLink(target)),
  reviewReclaim: (target) =>
    Effect.runPromise(walletEffects.reviewReclaim(target)),
  confirmReclaim: (shown) =>
    Effect.runPromise(walletEffects.confirmReclaim(shown)),
  paymentLink: (code) => Effect.runPromise(walletEffects.paymentLink(code)),
  reviewLinkReceive: (code) =>
    Effect.runPromise(walletEffects.reviewLinkReceive(code)),
  confirmLinkReceive: (shown, code) =>
    Effect.runPromise(walletEffects.confirmLinkReceive(shown, code)),
  reviewExternalLinkClaim: (code, intent) =>
    Effect.runPromise(walletEffects.reviewExternalLinkClaim(code, intent)),
  confirmExternalLinkClaim: (shown, code) =>
    Effect.runPromise(walletEffects.confirmExternalLinkClaim(shown, code)),
  quotePayout: (code) => Effect.runPromise(walletEffects.quotePayout(code)),
  reviewPayout: (code, destination, quote) =>
    Effect.runPromise(walletEffects.reviewPayout(code, destination, quote)),
  confirmPayout: (shown, code) =>
    Effect.runPromise(walletEffects.confirmPayout(shown, code)),
  followPayout: (id) => Effect.runPromise(walletEffects.followPayout(id)),
};
