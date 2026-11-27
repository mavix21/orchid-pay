import {
  type CorruptDeviceWallet,
  type KeyStore,
  KeyStoreUnavailable,
  type SealedDevice,
  type SealedKeyStore,
  browserAssertions,
  browserKeyStore,
  browserPasskeys,
  browserRelyingParty,
  makeWalletEffects,
} from "@workspace/wallet";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { port } from "./port.functions";
import { markWalletOnDevice } from "./wallet-cookie";

const failClosed = <A>(
  effect: Effect.Effect<A, KeyStoreUnavailable | CorruptDeviceWallet>,
) =>
  effect.pipe(
    Effect.catchTag("CorruptDeviceWallet", (cause) =>
      Effect.fail(new KeyStoreUnavailable({ cause })),
    ),
  );

export const deviceKeyStore: KeyStore = {
  readPublic: () =>
    failClosed(browserKeyStore.readPublic()).pipe(
      Effect.tap((stored) =>
        Effect.sync(() => markWalletOnDevice(Option.isSome(stored))),
      ),
    ),
  updatePublic: (update) =>
    failClosed(browserKeyStore.updatePublic(update)).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          if (Option.isSome(result)) markWalletOnDevice(true);
        }),
      ),
    ),
};

const restoreKeyStore: SealedKeyStore = {
  ...browserKeyStore,
  installSealed: (candidate, replacing) =>
    browserKeyStore.installSealed(candidate, replacing).pipe(
      Effect.tap((installed) =>
        Effect.sync(() => {
          if (installed) markWalletOnDevice(true);
        }),
      ),
    ),
};

export const sealedDevice: SealedDevice = {
  store: restoreKeyStore,
  ceremony: browserAssertions,
  relyingParty: browserRelyingParty,
};

export const walletEffects = makeWalletEffects(
  port,
  deviceKeyStore,
  browserPasskeys,
  sealedDevice,
);
