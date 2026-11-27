import { mnemonicToSeedSync } from "@scure/bip39";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HDKey } from "micro-key-producer/slip10.js";
import {
  type ExternalRecipient,
  type LinkRecipient,
  type Profile,
  SigningRequest,
  TransferDraft,
  type UnclaimedFundsId,
  type UnsignedEnvelope,
  Username,
  type WalletPort,
} from "../src/contract";
import { signingScheme } from "../src/device-network";
import {
  type KeyStore,
  KeyStoreUnavailable,
  PublicDeviceWallet,
} from "../src/device/key-store";
import {
  SecretPhrase,
  generateSecretPhrase,
} from "../src/device/secret-phrase";
import { addressOf, keyFromSeed } from "./test-keys";

export const knownPhrase = Schema.decodeSync(SecretPhrase)(
  "illness spike retreat truth genius clock brain pass fit cave bargain toe",
);

export const signingKey = (phrase: SecretPhrase) =>
  keyFromSeed(
    HDKey.fromMasterSeed(mnemonicToSeedSync(phrase)).derive(
      signingScheme.derivationPath,
    ).privateKey,
  );

export const nowSeconds = () => Math.floor(Date.now() / 1000);

export class DeviceWallet extends PublicDeviceWallet.extend<DeviceWallet>(
  "@workspace/wallet/test/DeviceWallet",
)({
  phrase: SecretPhrase,
}) {}

export const publicWalletOf = (wallet: DeviceWallet) =>
  new PublicDeviceWallet({
    address: wallet.address,
    username: wallet.username,
    reserveSponsor: wallet.reserveSponsor,
    backup: wallet.backup,
    transfer: wallet.transfer,
    approvedUntil: wallet.approvedUntil,
    linkReceipt: wallet.linkReceipt,
    transferRevision: wallet.transferRevision,
  });

export interface MemoryKeyStore extends KeyStore {
  seed(wallet: DeviceWallet): Effect.Effect<void>;
}

export function memoryKeyStore(
  initial = Option.none<DeviceWallet>(),
): MemoryKeyStore {
  let saved = Option.map(initial, publicWalletOf);
  const lock = Semaphore.makeUnsafe(1);

  return {
    seed: (wallet) =>
      lock.withPermit(
        Effect.sync(() => {
          saved = Option.some(publicWalletOf(wallet));
        }),
      ),
    readPublic: () => Effect.sync(() => saved),
    updatePublic: (update) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (Option.isNone(saved)) return Option.none();

          const current = saved.value;
          const next = update(current);

          if (Option.isNone(next))
            return Option.some({ wallet: current, updated: false });

          if (next.value.address !== current.address)
            return yield* new KeyStoreUnavailable({
              cause: new Error("Wallet address cannot change"),
            });

          saved = next;

          return Option.some({ wallet: next.value, updated: true });
        }),
      ),
  };
}

export const savedWallet = (store: KeyStore) =>
  store.readPublic().pipe(Effect.flatMap(Effect.fromOption), Effect.orDie);

export const unusedPort = (overrides: Partial<WalletPort> = {}): WalletPort => {
  const unused = () => Effect.die("Not used by test");

  return {
    overview: unused,
    open: unused,
    transfer: unused,
    manage: unused,
    paymentLinks: unused,
    activity: unused,
    paymentLink: unused,
    claimPaymentLink: unused,
    resolvePaymentLink: unused,
    quotePayout: unused,
    requestPayout: unused,
    payout: unused,
    restoreChallenge: unused,
    enrollmentChallenge: unused,
    enroll: unused,
    restore: unused,
    sessionChallenge: unused,
    beginSession: unused,
    ...overrides,
  };
};

export const enrolledDeviceWallet = (name = "maria") => {
  const phrase = generateSecretPhrase();

  return new DeviceWallet({
    phrase,
    address: addressOf(signingKey(phrase)),
    username: Schema.decodeSync(Username)(name),
    backup: "stored",
  });
};

export const transferDraftOf = (
  envelope: UnsignedEnvelope,
  recipient: Profile | LinkRecipient | ExternalRecipient,
  lifetime = 120,
  at = nowSeconds(),
  unclaimedFunds?: UnclaimedFundsId,
) =>
  new TransferDraft({
    request: new SigningRequest({
      envelope,
      expiresAt: DateTime.makeUnsafe((at + lifetime) * 1000),
    }),
    recipient,
    memoRequired: false,
    unclaimedFunds,
  });
