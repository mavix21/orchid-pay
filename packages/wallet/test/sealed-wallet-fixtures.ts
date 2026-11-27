import "fake-indexeddb/auto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { PasskeyChallenge, Username } from "../src/contract";
import { PinnedCredential } from "../src/device/assertion";
import { browserKeyStore } from "../src/device/browser-key-store";
import {
  type KeyStore,
  KeyStoreUnavailable,
  PublicDeviceWallet,
  type SealedDevice,
  SealedDeviceWallet,
} from "../src/device/key-store";
import {
  freshInstallationSalt,
  localEnvelopeVersion,
  localPhrasePrfInput,
  sealLocalEnvelope,
} from "../src/device/local-envelope";
import {
  type SecretPhrase,
  generateSecretPhrase,
} from "../src/device/secret-phrase";
import { network } from "../src/device-network";
import {
  type DeviceWallet,
  publicWalletOf,
  signingKey,
} from "./device-fixtures";
import { SoftwareAuthenticator } from "./software-authenticator";
import { assertTagged } from "./tagged";
import { addressOf } from "./test-keys";

export const relyingParty = {
  origin: "http://localhost:3000",
  rpId: "localhost",
};

const dummyChallenge = Schema.decodeSync(PasskeyChallenge)("A".repeat(43));

export type RawStoredEntry =
  | {
      readonly address: string;
      readonly username: string;
      readonly iv: string;
      readonly phrase: string;
    }
  | (Omit<typeof SealedDeviceWallet.Encoded, "credential"> & {
      readonly credential: {
        readonly id: string;
        readonly publicKey: string;
        readonly algorithm: string;
      };
    })
  | typeof SealedDeviceWallet.Encoded
  | ReadonlyArray<unknown>
  | CryptoKey;

const withEntryStore = <A>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<A>,
) =>
  new Promise<A>((resolve, reject) => {
    const request = indexedDB.open("orchid-device", 1);

    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains("entries"))
        request.result.createObjectStore("entries");
    });
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("success", () => {
      const transaction = request.result.transaction("entries", mode);
      const op = run(transaction.objectStore("entries"));

      op.addEventListener("error", () => reject(op.error));
      transaction.addEventListener("error", () => reject(transaction.error));
      transaction.addEventListener("abort", () => reject(transaction.error));
      transaction.addEventListener("complete", () => {
        request.result.close();
        resolve(op.result);
      });
    });
  });

export const clearDatabase = () =>
  withEntryStore("readwrite", (store) => store.clear());

export const storedEntry = (name: string) =>
  withEntryStore("readonly", (store) => store.get(name));

export const storedKeys = () =>
  withEntryStore("readonly", (store) => store.getAllKeys());

export const putRawEntry = (name: string, value: RawStoredEntry) =>
  withEntryStore("readwrite", (store) => store.put(value, name));

const sealPhrase = (phrase: SecretPhrase, publicWallet: PublicDeviceWallet) =>
  Effect.gen(function* () {
    const key = signingKey(phrase);
    const address = addressOf(key);
    const auth = new SoftwareAuthenticator(relyingParty.origin);
    const salt = freshInstallationSalt();
    const prfInput = yield* localPhrasePrfInput({ network, address, salt });

    const registered = Option.getOrThrow(
      auth.enrollWithPrf(dummyChallenge, prfInput),
    );

    const credential = new PinnedCredential({
      id: registered.registration.id,
      publicKey: registered.registration.publicKey,
      algorithm: "ES256",
    });

    const prf = Redacted.make(Uint8Array.from(registered.prf));

    const sealed = yield* sealLocalEnvelope(
      {
        phrase,
        network,
        address,
        credentialId: credential.id,
        salt,
      },
      prf,
    );

    assertTagged(sealed, "EnvelopeSealed");

    const record = new SealedDeviceWallet({
      version: localEnvelopeVersion,
      public: publicWallet,
      credential,
      envelope: sealed.envelope,
    });

    return {
      phrase,
      key,
      address,
      auth,
      salt,
      prf,
      credential,
      publicWallet,
      envelope: sealed.envelope,
      record,
    };
  });

export const enrollDisposableWallet = (name = "maria") => {
  const phrase = generateSecretPhrase();

  return sealPhrase(
    phrase,
    new PublicDeviceWallet({
      address: addressOf(signingKey(phrase)),
      username: Schema.decodeSync(Username)(name),
      backup: "stored",
    }),
  );
};

export const sealedKeyStore: KeyStore = {
  readPublic: () =>
    browserKeyStore
      .readPublic()
      .pipe(
        Effect.catchTag("CorruptDeviceWallet", (cause) =>
          Effect.fail(new KeyStoreUnavailable({ cause })),
        ),
      ),
  updatePublic: (update) =>
    browserKeyStore
      .updatePublic(update)
      .pipe(
        Effect.catchTag("CorruptDeviceWallet", (cause) =>
          Effect.fail(new KeyStoreUnavailable({ cause })),
        ),
      ),
};

export const approvingDevice = (
  auth: SoftwareAuthenticator,
  store = browserKeyStore,
): SealedDevice => ({
  store,
  ceremony: auth.assertions,
  relyingParty: () => relyingParty,
});

export const installSealedWallet = (wallet: DeviceWallet) =>
  Effect.gen(function* () {
    yield* Effect.promise(clearDatabase);

    const sealed = yield* sealPhrase(wallet.phrase, publicWalletOf(wallet));

    yield* browserKeyStore.installSealed(sealed.record);

    return sealed;
  });
