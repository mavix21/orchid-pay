import {
  KeyStoreUnavailable,
  PendingEnrollmentRecord,
  type PendingEnrollmentStorage,
  type SealedKeyStore,
  browserAssertions,
  browserKeyStore,
  browserRegistration,
  browserRelyingParty,
  makeEnrollmentEffects,
} from "@workspace/wallet";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { port } from "./port.functions";
import { markWalletOnDevice } from "./wallet-cookie";

const pendingStorageKey = "orchid-pending-enrollment";

const pendingRecordJson = Schema.fromJsonString(PendingEnrollmentRecord);
const decodePending = Schema.decodeUnknownOption(pendingRecordJson);
const encodePending = Schema.encodeSync(pendingRecordJson);

const sessionPendingEnrollment: PendingEnrollmentStorage = {
  read: () =>
    Effect.sync(() => {
      try {
        const raw = sessionStorage.getItem(pendingStorageKey);

        if (raw === null) return Option.none();

        const decoded = decodePending(raw);

        if (Option.isNone(decoded))
          sessionStorage.removeItem(pendingStorageKey);

        return decoded;
      } catch {
        return Option.none();
      }
    }),
  write: (record) =>
    Effect.try({
      try: () => {
        sessionStorage.setItem(pendingStorageKey, encodePending(record));
      },
      catch: (cause) => new KeyStoreUnavailable({ cause }),
    }),
  clear: () =>
    Effect.sync(() => {
      try {
        sessionStorage.removeItem(pendingStorageKey);
      } catch {}
    }),
};

const webSealedKeyStore: SealedKeyStore = {
  readPublic: () =>
    browserKeyStore
      .readPublic()
      .pipe(
        Effect.tap((stored) =>
          Effect.sync(() => markWalletOnDevice(Option.isSome(stored))),
        ),
      ),
  updatePublic: (update) =>
    browserKeyStore.updatePublic(update).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          if (Option.isSome(result)) markWalletOnDevice(true);
        }),
      ),
    ),
  readSealed: () => browserKeyStore.readSealed(),
  readLinks: () => browserKeyStore.readLinks(),
  updateRecords: (update) => browserKeyStore.updateRecords(update),
  writeSealed: (wallet) =>
    browserKeyStore
      .writeSealed(wallet)
      .pipe(Effect.tap(() => Effect.sync(() => markWalletOnDevice(true)))),
  installSealed: (wallet) =>
    browserKeyStore
      .installSealed(wallet)
      .pipe(Effect.tap(() => Effect.sync(() => markWalletOnDevice(true)))),
};

const walletInstallLock = "orchid-wallet-install";

const acrossTabs = <A, E>(run: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  "locks" in navigator
    ? Effect.tryPromise(() =>
        navigator.locks.request(walletInstallLock, () =>
          Effect.runPromiseExit(run),
        ),
      ).pipe(
        Effect.catch(() => Effect.exit(run)),
        Effect.flatMap((exit) => exit),
      )
    : run;

export const enrollmentEffects = makeEnrollmentEffects({
  port,
  store: webSealedKeyStore,
  registration: browserRegistration,
  assertions: browserAssertions,
  relyingParty: browserRelyingParty(),
  pending: sessionPendingEnrollment,
  exclusive: acrossTabs,
});
