import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type {
  AccountAddress,
  UnclaimedFundsId,
  Failed,
  Settled,
  TransferOrder,
} from "../contract";
import { network } from "../device-network";
import {
  type DeviceRecords,
  type DeviceRecordsUpdate,
  type KeyStore,
  KeyStoreUnavailable,
  type SealedKeyStore,
} from "./key-store";
import { SealedLinkCode } from "./link-seal";

type SavedLinks = ReadonlyArray<SealedLinkCode>;

const sameLink =
  (wallet: AccountAddress, address: AccountAddress) =>
  (saved: SealedLinkCode) =>
    saved.network === network &&
    saved.wallet === wallet &&
    saved.address === address;

export const savedLinkFor = (
  links: SavedLinks,
  wallet: AccountAddress,
  address: AccountAddress,
) => Option.fromNullishOr(links.find(sameLink(wallet, address)));

export const withSavedLink = (
  links: SavedLinks,
  sealed: SealedLinkCode,
): SavedLinks => [
  ...links.filter((saved) => !sameLink(sealed.wallet, sealed.address)(saved)),
  sealed,
];

export const restoredLinkSlot = (
  links: SavedLinks,
  wallet: AccountAddress,
  address: AccountAddress,
  previous: Option.Option<SealedLinkCode>,
): SavedLinks => [
  ...links.filter((saved) => !sameLink(wallet, address)(saved)),
  ...Option.toArray(previous),
];

const fundedLink = (
  links: SavedLinks,
  wallet: AccountAddress,
  address: AccountAddress,
  unclaimedFunds: UnclaimedFundsId,
): Option.Option<SavedLinks> =>
  Option.flatMap(savedLinkFor(links, wallet, address), (saved) =>
    saved.unclaimedFunds === unclaimedFunds
      ? Option.none()
      : Option.some(
          withSavedLink(
            links,
            new SealedLinkCode({ ...saved, unclaimedFunds }),
          ),
        ),
  );

export const recordFunded = (
  links: SavedLinks,
  wallet: AccountAddress,
  address: AccountAddress,
  unclaimedFunds: UnclaimedFundsId,
): SavedLinks =>
  Option.getOrElse(
    fundedLink(links, wallet, address, unclaimedFunds),
    () => links,
  );

const neverFunded = (
  links: SavedLinks,
  wallet: AccountAddress,
  address: AccountAddress,
): SavedLinks =>
  Option.match(savedLinkFor(links, wallet, address), {
    onNone: () => links,
    onSome: (saved) =>
      saved.unclaimedFunds === undefined
        ? links.filter((kept) => kept !== saved)
        : links,
  });

export const concludedLink = (
  links: SavedLinks,
  wallet: AccountAddress,
  order: TransferOrder,
  concluded: Settled | Failed,
): SavedLinks => {
  if (!Predicate.isTagged(order.to, "PaymentLink")) return links;

  if (Predicate.isTagged(concluded, "Failed"))
    return neverFunded(links, wallet, order.to.value);

  return concluded.unclaimedFunds === undefined
    ? links
    : recordFunded(links, wallet, order.to.value, concluded.unclaimedFunds);
};

export const withoutReclaimed = (
  links: SavedLinks,
  wallet: AccountAddress,
  unclaimedFunds: UnclaimedFundsId,
): SavedLinks => {
  const kept = links.filter(
    (saved) =>
      !(
        saved.network === network &&
        saved.wallet === wallet &&
        saved.unclaimedFunds === unclaimedFunds
      ),
  );

  return kept.length === links.length ? links : kept;
};

export interface RecordsStore {
  readLinks(): Effect.Effect<SavedLinks, KeyStoreUnavailable>;
  updateRecords(
    update: (current: DeviceRecords) => Option.Option<DeviceRecords>,
  ): Effect.Effect<Option.Option<DeviceRecordsUpdate>, KeyStoreUnavailable>;
}

export const recordsStore = (
  store: KeyStore,
  sealed: SealedKeyStore | undefined,
): RecordsStore =>
  sealed === undefined
    ? {
        readLinks: () => Effect.succeed([]),
        updateRecords: (update) =>
          store
            .updatePublic((wallet) =>
              Option.map(update({ wallet, links: [] }), (next) => next.wallet),
            )
            .pipe(
              Effect.map(
                Option.map(({ wallet, updated }) => ({
                  records: { wallet, links: [] },
                  updated,
                })),
              ),
            ),
      }
    : {
        readLinks: () => sealed.readLinks(),
        updateRecords: (update) =>
          sealed
            .updateRecords(update)
            .pipe(
              Effect.catchTag("CorruptDeviceWallet", (cause) =>
                Effect.fail(new KeyStoreUnavailable({ cause })),
              ),
            ),
      };
