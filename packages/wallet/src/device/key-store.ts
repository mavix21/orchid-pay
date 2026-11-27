import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  PaymentLinkReceipt,
  PaymentRequestId,
  type TransferId,
  TransferOrder,
  Username,
} from "../contract";
import {
  type AssertionCeremony,
  PinnedCredential,
  type RelyingParty,
} from "./assertion";
import type { SealedLinkCode } from "./link-seal";
import { LocalPhraseEnvelope, localEnvelopeVersion } from "./local-envelope";

export const BackupState = Schema.Literals(["stored"]);

export class PublicDeviceWallet extends Schema.Class<PublicDeviceWallet>(
  "@workspace/wallet/PublicDeviceWallet",
)({
  address: AccountAddress,
  username: Username,
  reserveSponsor: Schema.optional(AccountAddress),
  backup: Schema.optional(BackupState),
  transfer: Schema.optional(TransferOrder),
  approvedUntil: Schema.optional(Schema.Number),
  linkReceipt: Schema.optional(PaymentLinkReceipt),
  transferRevision: Schema.optional(Schema.Number),
  paymentRequest: Schema.optional(PaymentRequestId),
}) {}

export class SealedDeviceWallet extends Schema.Class<SealedDeviceWallet>(
  "@workspace/wallet/SealedDeviceWallet",
)({
  version: Schema.Literal(localEnvelopeVersion),
  public: PublicDeviceWallet,
  credential: PinnedCredential,
  envelope: LocalPhraseEnvelope,
}) {}

export class KeyStoreUnavailable extends Schema.TaggedError<KeyStoreUnavailable>()(
  "KeyStoreUnavailable",
  { cause: Schema.Defect() },
) {}

export class CorruptDeviceWallet extends Schema.TaggedError<CorruptDeviceWallet>()(
  "CorruptDeviceWallet",
  {},
) {}

export interface LinkClearTarget {
  readonly address: AccountAddress;
  readonly transferId: TransferId | undefined;
  readonly approvedUntil: number | undefined;
  readonly receipt: PaymentLinkReceipt;
}

export interface PublicWalletUpdate {
  readonly wallet: PublicDeviceWallet;
  readonly updated: boolean;
}

export interface DeviceRecords {
  readonly wallet: PublicDeviceWallet;
  readonly links: ReadonlyArray<SealedLinkCode>;
}

export interface DeviceRecordsUpdate {
  readonly records: DeviceRecords;
  readonly updated: boolean;
}

export interface SealedKeyStore {
  readPublic(): Effect.Effect<
    Option.Option<PublicDeviceWallet>,
    KeyStoreUnavailable | CorruptDeviceWallet
  >;
  updatePublic(
    update: (current: PublicDeviceWallet) => Option.Option<PublicDeviceWallet>,
  ): Effect.Effect<
    Option.Option<PublicWalletUpdate>,
    KeyStoreUnavailable | CorruptDeviceWallet
  >;
  readSealed(): Effect.Effect<
    Option.Option<SealedDeviceWallet>,
    KeyStoreUnavailable | CorruptDeviceWallet
  >;
  writeSealed(
    wallet: SealedDeviceWallet,
  ): Effect.Effect<void, KeyStoreUnavailable>;
  installSealed(
    wallet: SealedDeviceWallet,
    replacing?: "same-address",
  ): Effect.Effect<boolean, KeyStoreUnavailable | CorruptDeviceWallet>;
  readLinks(): Effect.Effect<
    ReadonlyArray<SealedLinkCode>,
    KeyStoreUnavailable
  >;
  updateRecords(
    update: (current: DeviceRecords) => Option.Option<DeviceRecords>,
  ): Effect.Effect<
    Option.Option<DeviceRecordsUpdate>,
    KeyStoreUnavailable | CorruptDeviceWallet
  >;
}

export interface SealedDevice {
  readonly store: SealedKeyStore;
  readonly ceremony: AssertionCeremony;
  readonly relyingParty: () => RelyingParty;
}

export interface KeyStore {
  readPublic(): Effect.Effect<
    Option.Option<PublicDeviceWallet>,
    KeyStoreUnavailable
  >;
  updatePublic(
    update: (current: PublicDeviceWallet) => Option.Option<PublicDeviceWallet>,
  ): Effect.Effect<Option.Option<PublicWalletUpdate>, KeyStoreUnavailable>;
}

export const receiptJson = Schema.encodeSync(
  Schema.fromJsonString(Schema.NullOr(PaymentLinkReceipt)),
);

export const sameLinkState = (
  wallet: Pick<
    PublicDeviceWallet,
    "address" | "transfer" | "approvedUntil" | "linkReceipt"
  >,
  expected: LinkClearTarget,
) =>
  wallet.address === expected.address &&
  wallet.transfer?.id === expected.transferId &&
  wallet.approvedUntil === expected.approvedUntil &&
  receiptJson(wallet.linkReceipt ?? null) === receiptJson(expected.receipt);

export const clearedLink = (current: PublicDeviceWallet) =>
  new PublicDeviceWallet({
    ...current,
    transfer: undefined,
    approvedUntil: undefined,
    linkReceipt: undefined,
    paymentRequest: undefined,
    transferRevision: (current.transferRevision ?? 0) + 1,
  });

export const clearStoredLink = Effect.fn("Device.clearStoredLink")(function* <
  E,
>(
  store: {
    updatePublic(
      update: (
        current: PublicDeviceWallet,
      ) => Option.Option<PublicDeviceWallet>,
    ): Effect.Effect<Option.Option<PublicWalletUpdate>, E>;
  },
  expected: LinkClearTarget,
) {
  yield* store.updatePublic((current) =>
    sameLinkState(current, expected)
      ? Option.some(clearedLink(current))
      : Option.none(),
  );
});
