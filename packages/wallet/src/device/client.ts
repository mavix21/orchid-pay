import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import {
  BackupStored,
  type WalletPort,
  type WalletUnavailable,
} from "../contract";
import {
  type KeyStore,
  type KeyStoreUnavailable,
  PublicDeviceWallet,
  type SealedDevice,
} from "./key-store";
import { NoWallet, SavedWallet, UnsupportedDevice } from "./outcomes";
import type { PasskeyCancelled, PasskeyFailed, Passkeys } from "./passkeys";
import type { HeldLink } from "./payment-links";
import { loadFromServer } from "./reaching";
import type { ClaimIssue } from "./claim-reviews";
import type { RestoreProgress } from "./restore";
import { deviceSession } from "./session";
import { directRoute } from "./transfer-route";
import type { WalletClient, WalletEffects } from "./client-interfaces";

export * from "./outcomes";

export type { WalletClient, WalletEffects } from "./client-interfaces";

export * from "./passkeys";

export { loadFromServer, unreachedServer } from "./reaching";

export function makeWalletEffects(
  port: WalletPort,
  store: KeyStore,
  passkeys: Passkeys,
  device?: SealedDevice,
): WalletEffects {
  const restoreProgress: RestoreProgress = {
    pending: Ref.makeUnsafe(Option.none()),
    lock: Semaphore.makeUnsafe(1),
  };

  const issuedReview = Ref.makeUnsafe(Option.none<string>());
  const heldLink = Ref.makeUnsafe(Option.none<HeldLink>());
  const issuedOpening = Ref.makeUnsafe(Option.none<string>());

  const reclaimIssue = Ref.makeUnsafe<ClaimIssue>({
    ticket: 0,
    issued: Option.none(),
  });

  const receiveIssue = Ref.makeUnsafe<ClaimIssue>({
    ticket: 0,
    issued: Option.none(),
  });

  const externalIssue = Ref.makeUnsafe<ClaimIssue>({
    ticket: 0,
    issued: Option.none(),
  });

  const sending = loadFromServer(() => import("./sending")).pipe(
    Effect.map(({ sendTransfer }) =>
      sendTransfer(port, directRoute(port), store, {
        issued: issuedReview,
        device,
      }),
    ),
  );

  const links = loadFromServer(() => import("./payment-links")).pipe(
    Effect.map(({ devicePaymentLinks }) =>
      devicePaymentLinks(
        port,
        store,
        { issued: issuedReview, device },
        heldLink,
      ),
    ),
  );

  const reclaim = loadFromServer(() => import("./reclaim")).pipe(
    Effect.map(({ deviceReclaim }) =>
      deviceReclaim(port, store, { state: reclaimIssue, device }),
    ),
  );

  const receiving = loadFromServer(() => import("./link-receive")).pipe(
    Effect.map(({ deviceLinkReceive }) =>
      deviceLinkReceive(port, store, { state: receiveIssue, device }),
    ),
  );

  const externalClaim = loadFromServer(
    () => import("./external-link-claim"),
  ).pipe(
    Effect.map(({ deviceExternalLinkClaim }) =>
      deviceExternalLinkClaim(port, externalIssue),
    ),
  );

  const payoutIssue = Ref.makeUnsafe<ClaimIssue>({
    ticket: 0,
    issued: Option.none(),
  });

  const issuedPayout = Ref.makeUnsafe(Option.none<string>());

  const payouts = loadFromServer(() => import("./payouts")).pipe(
    Effect.map(({ devicePayouts }) =>
      devicePayouts(port, { claim: payoutIssue, issued: issuedPayout }),
    ),
  );

  const opening = loadFromServer(() => import("./opening")).pipe(
    Effect.map(({ deviceOpening }) =>
      deviceOpening(port, store, { issued: issuedOpening, device }),
    ),
  );

  const backUp = Effect.fn("Device.backUp")(function* () {
    const stored = yield* store.readPublic();

    if (Option.isNone(stored)) return new NoWallet();

    return stored.value.backup === "stored"
      ? new BackupStored()
      : new UnsupportedDevice();
  });

  const restore = Effect.fn("Device.restore")(function* () {
    if (device === undefined) return new UnsupportedDevice();

    const { deviceRestore } = yield* loadFromServer(() => import("./restore"));

    return yield* deviceRestore(
      port,
      passkeys,
      device,
      restoreProgress,
    ).restore();
  });

  const serializedRestore = () =>
    restoreProgress.lock.withPermits(1)(restore());

  const overview = Effect.fn("Device.overview")(function* () {
    const stored = yield* store.readPublic();

    if (Option.isNone(stored)) return new NoWallet();

    const overview = yield* port.overview(stored.value.address);

    if (
      Predicate.isTagged(overview, "Holding") ||
      Predicate.isTagged(overview, "NeedsReopening")
    )
      yield* store.updatePublic((current) => {
        if (current.address !== stored.value.address) return Option.none();

        const reserveSponsor =
          Predicate.isTagged(overview, "Holding") &&
          Option.isSome(overview.reserveSponsor) &&
          current.reserveSponsor === undefined
            ? overview.reserveSponsor.value
            : current.reserveSponsor;

        const username =
          overview.profile.address === current.address
            ? overview.profile.username
            : current.username;

        return reserveSponsor === current.reserveSponsor &&
          username === current.username
          ? Option.none()
          : Option.some(
              new PublicDeviceWallet({
                ...current,
                username,
                reserveSponsor,
              }),
            );
      });

    return overview;
  });

  const saved = Effect.fn("Device.saved")(function* () {
    const stored = yield* store.readPublic();

    return Option.match(stored, {
      onNone: () => new NoWallet(),
      onSome: (wallet) =>
        new SavedWallet({
          username: wallet.username,
          openingApproved: wallet.reserveSponsor !== undefined,
          backup: wallet.backup ?? "none",
        }),
    });
  });

  const session = deviceSession(port, device);

  const settle = <A>(
    program: Effect.Effect<
      A,
      KeyStoreUnavailable | WalletUnavailable | PasskeyCancelled | PasskeyFailed
    >,
  ) =>
    program.pipe(
      Effect.catchTags({
        KeyStoreUnavailable: () => Effect.succeed(new UnsupportedDevice()),
        Offline: (failure) => Effect.succeed(failure),
        ServerUnreachable: (failure) => Effect.succeed(failure),
        LedgerUnreachable: (failure) => Effect.succeed(failure),
        ServiceFailed: (failure) => Effect.succeed(failure),
        SessionRequired: (failure) => Effect.succeed(failure),
        RateLimited: (failure) => Effect.succeed(failure),
        InvalidResponse: (failure) => Effect.succeed(failure),
        PasskeyCancelled: (cancelled) => Effect.succeed(cancelled),
        PasskeyFailed: (failed) => Effect.succeed(failed),
      }),
    );

  const transfer = <A>(
    program: Effect.Effect<A, KeyStoreUnavailable | WalletUnavailable>,
  ) =>
    program.pipe(
      Effect.catchTags({
        KeyStoreUnavailable: () => Effect.succeed(new UnsupportedDevice()),
        Offline: (failure) => Effect.succeed(failure),
        ServerUnreachable: (failure) => Effect.succeed(failure),
        LedgerUnreachable: (failure) => Effect.succeed(failure),
        ServiceFailed: (failure) => Effect.succeed(failure),
        SessionRequired: (failure) => Effect.succeed(failure),
        RateLimited: (failure) => Effect.succeed(failure),
        InvalidResponse: (failure) => Effect.succeed(failure),
      }),
    );

  const networkOnly = <A>(program: Effect.Effect<A, WalletUnavailable>) =>
    program.pipe(
      Effect.catchTags({
        Offline: (failure) => Effect.succeed(failure),
        ServerUnreachable: (failure) => Effect.succeed(failure),
        LedgerUnreachable: (failure) => Effect.succeed(failure),
        ServiceFailed: (failure) => Effect.succeed(failure),
        SessionRequired: (failure) => Effect.succeed(failure),
        RateLimited: (failure) => Effect.succeed(failure),
        InvalidResponse: (failure) => Effect.succeed(failure),
      }),
    );

  return {
    saved: () =>
      saved().pipe(
        Effect.catchTag("KeyStoreUnavailable", () =>
          Effect.succeed(new UnsupportedDevice()),
        ),
      ),
    overview: () =>
      overview().pipe(
        Effect.catchTags({
          KeyStoreUnavailable: () => Effect.succeed(new UnsupportedDevice()),
          Offline: (failure) => Effect.succeed(failure),
          ServerUnreachable: (failure) => Effect.succeed(failure),
          LedgerUnreachable: (failure) => Effect.succeed(failure),
          ServiceFailed: (failure) => Effect.succeed(failure),
          SessionRequired: (failure) => Effect.succeed(failure),
          RateLimited: (failure) => Effect.succeed(failure),
          InvalidResponse: (failure) => Effect.succeed(failure),
        }),
      ),
    sessionChallenge: () => networkOnly(session.challenge()),
    confirmSession: (challenge) =>
      settle(
        session
          .confirm(challenge)
          .pipe(
            Effect.catchTag("CorruptDeviceWallet", (damaged) =>
              Effect.succeed(damaged),
            ),
          ),
      ),
    reviewOpening: (usernameText) =>
      settle(
        opening.pipe(Effect.flatMap(({ review }) => review(usernameText))),
      ),
    confirmOpening: (shown) =>
      settle(
        opening.pipe(
          Effect.flatMap(({ confirm }) => confirm(shown)),
          Effect.catchTag("CorruptDeviceWallet", (damaged) =>
            Effect.succeed(damaged),
          ),
        ),
      ),
    backUp: () => settle(backUp()),
    restore: () =>
      settle(
        serializedRestore().pipe(
          Effect.catchTag("CorruptDeviceWallet", (damaged) =>
            Effect.succeed(damaged),
          ),
        ),
      ),
    cancelRestore: () =>
      restoreProgress.lock.withPermits(1)(
        Ref.set(restoreProgress.pending, Option.none()),
      ),
    review: (intent) =>
      transfer(sending.pipe(Effect.flatMap(({ review }) => review(intent)))),
    confirm: (shown) =>
      transfer(
        sending.pipe(
          Effect.flatMap(({ confirm }) => confirm(shown)),
          Effect.catchTag("CorruptDeviceWallet", (damaged) =>
            Effect.succeed(damaged),
          ),
        ),
      ),
    resume: (id) =>
      transfer(sending.pipe(Effect.flatMap(({ resume }) => resume(id)))),
    reviewPaymentLink: (intent) =>
      transfer(links.pipe(Effect.flatMap(({ review }) => review(intent)))),
    confirmPaymentLink: (shown) =>
      transfer(
        links.pipe(
          Effect.flatMap(({ confirm }) => confirm(shown)),
          Effect.catchTag("CorruptDeviceWallet", (damaged) =>
            Effect.succeed(damaged),
          ),
        ),
      ),
    paymentLinks: () =>
      transfer(
        links.pipe(Effect.flatMap(({ paymentLinks }) => paymentLinks())),
      ),
    resolvePaymentLink: () =>
      transfer(
        links.pipe(
          Effect.flatMap(({ resolvePaymentLink }) => resolvePaymentLink()),
        ),
      ),
    revealPaymentLink: (target) =>
      settle(
        links.pipe(
          Effect.flatMap(({ reveal }) => reveal(target)),
          Effect.catchTag("CorruptDeviceWallet", (damaged) =>
            Effect.succeed(damaged),
          ),
        ),
      ),
    reviewReclaim: (target) =>
      transfer(reclaim.pipe(Effect.flatMap(({ review }) => review(target)))),
    confirmReclaim: (shown) =>
      transfer(
        reclaim.pipe(
          Effect.flatMap(({ confirm }) => confirm(shown)),
          Effect.catchTag("CorruptDeviceWallet", (damaged) =>
            Effect.succeed(damaged),
          ),
        ),
      ),
    paymentLink: (code) =>
      transfer(receiving.pipe(Effect.flatMap(({ status }) => status(code)))),
    reviewLinkReceive: (code) =>
      transfer(receiving.pipe(Effect.flatMap(({ review }) => review(code)))),
    confirmLinkReceive: (shown, code) =>
      transfer(
        receiving.pipe(
          Effect.flatMap(({ confirm }) => confirm(shown, code)),
          Effect.catchTag("CorruptDeviceWallet", (damaged) =>
            Effect.succeed(damaged),
          ),
        ),
      ),
    reviewExternalLinkClaim: (code, intent) =>
      networkOnly(
        externalClaim.pipe(
          Effect.flatMap(({ review }) => review(code, intent)),
        ),
      ),
    confirmExternalLinkClaim: (shown, code) =>
      networkOnly(
        externalClaim.pipe(
          Effect.flatMap(({ confirm }) => confirm(shown, code)),
        ),
      ),
    quotePayout: (code, currency) =>
      networkOnly(
        payouts.pipe(Effect.flatMap(({ quote }) => quote(code, currency))),
      ),
    reviewPayout: (code, destination, quoted) =>
      networkOnly(
        payouts.pipe(
          Effect.flatMap(({ review }) => review(code, destination, quoted)),
        ),
      ),
    confirmPayout: (shown, code) =>
      networkOnly(
        payouts.pipe(Effect.flatMap(({ confirm }) => confirm(shown, code))),
      ),
    followPayout: (id) =>
      networkOnly(payouts.pipe(Effect.flatMap(({ follow }) => follow(id)))),
  };
}

export function makeWalletClient(
  port: WalletPort,
  store: KeyStore,
  passkeys: Passkeys,
  device?: SealedDevice,
): WalletClient {
  const effects = makeWalletEffects(port, store, passkeys, device);

  return {
    overview: () => Effect.runPromise(effects.overview()),
    saved: () => Effect.runPromise(effects.saved()),
    sessionChallenge: () => Effect.runPromise(effects.sessionChallenge()),
    confirmSession: (challenge) =>
      Effect.runPromise(effects.confirmSession(challenge)),
    reviewOpening: (usernameText) =>
      Effect.runPromise(effects.reviewOpening(usernameText)),
    confirmOpening: (shown) => Effect.runPromise(effects.confirmOpening(shown)),
    backUp: () => Effect.runPromise(effects.backUp()),
    restore: () => Effect.runPromise(effects.restore()),
    cancelRestore: () => Effect.runPromise(effects.cancelRestore()),
    review: (intent) => Effect.runPromise(effects.review(intent)),
    confirm: (shown) => Effect.runPromise(effects.confirm(shown)),
    resume: (id) => Effect.runPromise(effects.resume(id)),
    reviewPaymentLink: (intent) =>
      Effect.runPromise(effects.reviewPaymentLink(intent)),
    confirmPaymentLink: (shown) =>
      Effect.runPromise(effects.confirmPaymentLink(shown)),
    paymentLinks: () => Effect.runPromise(effects.paymentLinks()),
    resolvePaymentLink: () => Effect.runPromise(effects.resolvePaymentLink()),
    revealPaymentLink: (target) =>
      Effect.runPromise(effects.revealPaymentLink(target)),
    reviewReclaim: (target) => Effect.runPromise(effects.reviewReclaim(target)),
    confirmReclaim: (shown) => Effect.runPromise(effects.confirmReclaim(shown)),
    paymentLink: (code) => Effect.runPromise(effects.paymentLink(code)),
    reviewLinkReceive: (code) =>
      Effect.runPromise(effects.reviewLinkReceive(code)),
    confirmLinkReceive: (shown, code) =>
      Effect.runPromise(effects.confirmLinkReceive(shown, code)),
    reviewExternalLinkClaim: (code, intent) =>
      Effect.runPromise(effects.reviewExternalLinkClaim(code, intent)),
    confirmExternalLinkClaim: (shown, code) =>
      Effect.runPromise(effects.confirmExternalLinkClaim(shown, code)),
    quotePayout: (code, currency) =>
      Effect.runPromise(effects.quotePayout(code, currency)),
    reviewPayout: (code, destination, quoted) =>
      Effect.runPromise(effects.reviewPayout(code, destination, quoted)),
    confirmPayout: (shown, code) =>
      Effect.runPromise(effects.confirmPayout(shown, code)),
    followPayout: (id) => Effect.runPromise(effects.followPayout(id)),
  };
}
