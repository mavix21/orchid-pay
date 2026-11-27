import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { network } from "../device-network";
import {
  CorruptDeviceWallet,
  type DeviceRecords,
  type DeviceRecordsUpdate,
  KeyStoreUnavailable,
  PublicDeviceWallet,
  type PublicWalletUpdate,
  SealedDeviceWallet,
  type SealedKeyStore,
} from "./key-store";
import { SealedLinkCode } from "./link-seal";
import { localEnvelopeVersion, matchesEnvelopeContext } from "./local-envelope";

const databaseName = "orchid-device";
const entries = "entries";
const walletEntry = "wallet";
const linksEntry = "payment-links";

const StoredVersion = Schema.Struct({
  version: Schema.Literal(localEnvelopeVersion),
});

const isCurrentVersion = Schema.is(StoredVersion);
const decodeStoredWallet = Schema.decodeUnknownOption(SealedDeviceWallet);

const decodeStoredEntries = Schema.decodeUnknownOption(
  Schema.Array(Schema.Unknown),
);

const decodeStoredLink = Schema.decodeUnknownOption(SealedLinkCode);
const encodeStoredLink = Schema.encodeSync(SealedLinkCode);

function settle<A>(request: IDBRequest<A>): Promise<A> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(databaseName, 1);

  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(entries))
      request.result.createObjectStore(entries);
  });

  return settle(request);
}

async function readSealedWallet(): Promise<Option.Option<SealedDeviceWallet>> {
  const database = await openDatabase();

  try {
    const raw = await settle(
      database.transaction(entries).objectStore(entries).get(walletEntry),
    );

    if (!isCurrentVersion(raw)) return Option.none();

    const decoded = decodeStoredWallet(raw);

    if (Option.isNone(decoded)) throw new CorruptDeviceWallet();

    return decoded;
  } finally {
    database.close();
  }
}

async function readPublicWallet(): Promise<Option.Option<PublicDeviceWallet>> {
  return Option.map(await readSealedWallet(), (stored) => stored.public);
}

async function writeSealedWallet(wallet: SealedDeviceWallet): Promise<void> {
  if (
    !matchesEnvelopeContext(wallet.envelope, {
      network,
      address: wallet.public.address,
      credentialId: wallet.credential.id,
    })
  )
    throw new Error("Sealed wallet envelope does not match wallet context");

  const encoded = Schema.encodeSync(SealedDeviceWallet)(wallet);
  const database = await openDatabase();

  try {
    const transaction = database.transaction(entries, "readwrite");
    const objectStore = transaction.objectStore(entries);

    objectStore.clear();
    objectStore.put(encoded, walletEntry);

    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("error", () => reject(transaction.error));
      transaction.addEventListener("abort", () => reject(transaction.error));
    });
  } finally {
    database.close();
  }
}

function resealed(
  existing: SealedDeviceWallet,
  candidate: SealedDeviceWallet,
): Option.Option<SealedDeviceWallet> {
  if (
    !matchesEnvelopeContext(existing.envelope, {
      network,
      address: existing.public.address,
      credentialId: existing.credential.id,
    })
  )
    throw new CorruptDeviceWallet();

  if (existing.public.address !== candidate.public.address)
    return Option.none();

  return Option.some(
    new SealedDeviceWallet({
      version: candidate.version,
      public: new PublicDeviceWallet({ ...existing.public, backup: "stored" }),
      credential: candidate.credential,
      envelope: candidate.envelope,
    }),
  );
}

async function installSealedWallet(
  wallet: SealedDeviceWallet,
  replacing: "same-address" | undefined,
): Promise<boolean> {
  if (
    !matchesEnvelopeContext(wallet.envelope, {
      network,
      address: wallet.public.address,
      credentialId: wallet.credential.id,
    })
  )
    throw new Error("Sealed wallet envelope does not match wallet context");

  const encoded = Schema.encodeSync(SealedDeviceWallet)(wallet);
  const database = await openDatabase();

  try {
    const transaction = database.transaction(entries, "readwrite");
    const objectStore = transaction.objectStore(entries);

    return await new Promise<boolean>((resolve, reject) => {
      let installed = false;
      const request = objectStore.get(walletEntry);

      request.addEventListener("error", () => reject(request.error));
      request.addEventListener("success", () => {
        try {
          if (isCurrentVersion(request.result)) {
            const existing = decodeStoredWallet(request.result);

            if (Option.isNone(existing)) throw new CorruptDeviceWallet();

            const replacement =
              replacing === "same-address"
                ? resealed(existing.value, wallet)
                : Option.none();

            if (Option.isSome(replacement)) {
              objectStore.put(
                Schema.encodeSync(SealedDeviceWallet)(replacement.value),
                walletEntry,
              );
              installed = true;
            }

            return;
          }

          objectStore.clear();
          objectStore.put(encoded, walletEntry);
          installed = true;
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      });

      transaction.addEventListener("complete", () => resolve(installed));
      transaction.addEventListener("error", () => reject(transaction.error));
      transaction.addEventListener("abort", () => reject(transaction.error));
    });
  } finally {
    database.close();
  }
}

const storedLinks = (stored: Option.Option<ReadonlyArray<unknown>>) => {
  const entries = Option.getOrElse(stored, () => []);

  return {
    links: entries.flatMap((entry) => Option.toArray(decodeStoredLink(entry))),
    unreadable: entries.filter((entry) =>
      Option.isNone(decodeStoredLink(entry)),
    ),
  };
};

async function readLinks(): Promise<ReadonlyArray<SealedLinkCode>> {
  const database = await openDatabase();

  try {
    return storedLinks(
      decodeStoredEntries(
        await settle(
          database.transaction(entries).objectStore(entries).get(linksEntry),
        ),
      ),
    ).links;
  } finally {
    database.close();
  }
}

async function updateDeviceRecords(
  update: (current: DeviceRecords) => Option.Option<DeviceRecords>,
): Promise<Option.Option<DeviceRecordsUpdate>> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(entries, "readwrite");
    const objectStore = transaction.objectStore(entries);

    return await new Promise<Option.Option<DeviceRecordsUpdate>>(
      (resolve, reject) => {
        let result: Option.Option<DeviceRecordsUpdate> = Option.none();
        const walletRequest = objectStore.get(walletEntry);
        const linksRequest = objectStore.get(linksEntry);

        walletRequest.addEventListener("error", () =>
          reject(walletRequest.error),
        );
        linksRequest.addEventListener("error", () =>
          reject(linksRequest.error),
        );
        linksRequest.addEventListener("success", () => {
          try {
            if (!isCurrentVersion(walletRequest.result)) return;

            const stored = decodeStoredWallet(walletRequest.result);

            if (Option.isNone(stored)) throw new CorruptDeviceWallet();

            const { links, unreadable } = storedLinks(
              decodeStoredEntries(linksRequest.result),
            );

            const current = { wallet: stored.value.public, links };
            const next = update(current);

            if (Option.isNone(next)) {
              result = Option.some({ records: current, updated: false });

              return;
            }

            if (next.value.wallet.address !== current.wallet.address)
              throw new Error("Wallet address cannot change");

            if (next.value.wallet !== current.wallet)
              objectStore.put(
                Schema.encodeSync(SealedDeviceWallet)(
                  new SealedDeviceWallet({
                    version: stored.value.version,
                    public: next.value.wallet,
                    credential: stored.value.credential,
                    envelope: stored.value.envelope,
                  }),
                ),
                walletEntry,
              );

            if (next.value.links !== current.links)
              objectStore.put(
                [
                  ...unreadable,
                  ...next.value.links.map((link) => encodeStoredLink(link)),
                ],
                linksEntry,
              );

            result = Option.some({ records: next.value, updated: true });
          } catch (error) {
            transaction.abort();
            reject(error);
          }
        });

        transaction.addEventListener("complete", () => resolve(result));
        transaction.addEventListener("error", () => reject(transaction.error));
        transaction.addEventListener("abort", () => reject(transaction.error));
      },
    );
  } finally {
    database.close();
  }
}

const updatePublicWallet = async (
  update: (current: PublicDeviceWallet) => Option.Option<PublicDeviceWallet>,
): Promise<Option.Option<PublicWalletUpdate>> =>
  Option.map(
    await updateDeviceRecords((current) =>
      Option.map(update(current.wallet), (wallet) => ({
        wallet,
        links: current.links,
      })),
    ),
    ({ records, updated }) => ({ wallet: records.wallet, updated }),
  );

const failure = (cause: unknown) =>
  cause instanceof CorruptDeviceWallet
    ? cause
    : new KeyStoreUnavailable({ cause });

export const browserKeyStore: SealedKeyStore = {
  readPublic: () =>
    Effect.tryPromise({
      try: readPublicWallet,
      catch: failure,
    }),
  updatePublic: (update) =>
    Effect.tryPromise({
      try: () => updatePublicWallet(update),
      catch: failure,
    }),
  readSealed: () =>
    Effect.tryPromise({
      try: readSealedWallet,
      catch: failure,
    }),
  writeSealed: (wallet) =>
    Effect.tryPromise({
      try: () => writeSealedWallet(wallet),
      catch: (cause) => new KeyStoreUnavailable({ cause }),
    }),
  installSealed: (wallet, replacing) =>
    Effect.tryPromise({
      try: () => installSealedWallet(wallet, replacing),
      catch: failure,
    }),
  readLinks: () =>
    Effect.tryPromise({
      try: readLinks,
      catch: (cause) => new KeyStoreUnavailable({ cause }),
    }),
  updateRecords: (update) =>
    Effect.tryPromise({
      try: () => updateDeviceRecords(update),
      catch: failure,
    }),
};
