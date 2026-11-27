import "fake-indexeddb/auto";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Username } from "../src/contract";
import type { AssertionCeremony } from "../src/device/assertion";
import { browserKeyStore } from "../src/device/browser-key-store";
import {
  CorruptDeviceWallet,
  PublicDeviceWallet,
  SealedDeviceWallet,
} from "../src/device/key-store";
import {
  reopenLocalEnvelope,
  sealLocalEnvelope,
} from "../src/device/local-envelope";
import { network } from "../src/device-network";
import {
  clearDatabase,
  enrollDisposableWallet,
  putRawEntry,
  relyingParty,
  storedEntry,
  storedKeys,
} from "./sealed-wallet-fixtures";
import { assertTagged } from "./tagged";
import { randomAddress } from "./test-keys";

const normalizeBytes = (bytes: Uint8Array) =>
  `${Buffer.from(bytes).toString("base64")}:${Buffer.from(bytes).toString("hex")}`;

const unwrapValue = <A>(value: A): Schema.Json => {
  if (Redacted.isRedacted(value)) return unwrapValue(Redacted.value(value));

  if (value instanceof Uint8Array) return normalizeBytes(value);

  if (value instanceof ArrayBuffer)
    return normalizeBytes(new Uint8Array(value));

  if (ArrayBuffer.isView(value))
    return normalizeBytes(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );

  if (Array.isArray(value)) return value.map((item) => unwrapValue(item));

  if (Predicate.isObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, unwrapValue(entry)]),
    );

  if (Predicate.isString(value)) return value;

  if (Predicate.isNumber(value)) return value;

  if (Predicate.isBoolean(value)) return value;

  if (value === null) return null;

  return String(value);
};

const serializeForLeakCheck = <A>(value: A) =>
  JSON.stringify(unwrapValue(value));

it.effect(
  "persists without leaking secrets, keeps the envelope through public updates, and reopens with a fresh pinned assertion",
  () =>
    Effect.gen(function* () {
      yield* Effect.promise(clearDatabase);

      expect(yield* browserKeyStore.readPublic()).toEqual(Option.none());
      expect(yield* browserKeyStore.readSealed()).toEqual(Option.none());

      const disposable = yield* enrollDisposableWallet();

      const requestPayloads: Array<string> = [];
      const logLines: Array<string> = [];

      const observingCeremony: AssertionCeremony = {
        assert: (request) =>
          Effect.sync(() => {
            requestPayloads.push(serializeForLeakCheck(request));
          }).pipe(Effect.andThen(disposable.auth.assertions.assert(request))),
      };

      const captureLogger = Logger.make((options) => {
        logLines.push(String(options.message));
      });

      const candidateProof = yield* reopenLocalEnvelope(
        observingCeremony,
        relyingParty,
        disposable.credential,
        disposable.envelope,
        {
          network,
          address: disposable.address,
          purpose: "backup",
        },
      ).pipe(Effect.provide(Logger.layer([captureLogger])));

      assertTagged(candidateProof, "PhraseOpened");
      expect(Redacted.value(candidateProof.phrase)).toBe(disposable.phrase);

      yield* browserKeyStore.writeSealed(disposable.record);

      const keys = yield* Effect.promise(storedKeys);
      const rawRecord = yield* Effect.promise(() => storedEntry("wallet"));
      const serializedRecord = serializeForLeakCheck(rawRecord);
      const serializedRequests = requestPayloads.join("\n");
      const serializedLogs = logLines.join("\n");
      const prfBytes = Redacted.value(disposable.prf);

      const forbiddenSecrets = [
        disposable.phrase,
        Buffer.from(disposable.phrase).toString("base64"),
        Buffer.from(disposable.key.privateKey).toString("base64"),
        Buffer.from(disposable.key.privateKey).toString("hex"),
        Buffer.from(prfBytes).toString("base64"),
        Buffer.from(prfBytes).toString("hex"),
      ];

      expect(keys).toEqual(["wallet"]);

      for (const secret of forbiddenSecrets) {
        expect(serializedRecord).not.toContain(secret);
        expect(serializedRequests).not.toContain(secret);
        expect(serializedLogs).not.toContain(secret);
      }

      const beforeEnvelope = Option.getOrThrow(
        yield* browserKeyStore.readSealed(),
      ).envelope;

      const nextUsername = Schema.decodeSync(Username)("ana");
      const nextSponsor = randomAddress();

      const updated = yield* browserKeyStore.updatePublic((current) =>
        Option.some(
          new PublicDeviceWallet({
            ...current,
            username: nextUsername,
            reserveSponsor: nextSponsor,
          }),
        ),
      );

      expect(updated).toEqual(
        Option.some({
          wallet: new PublicDeviceWallet({
            ...disposable.publicWallet,
            username: nextUsername,
            reserveSponsor: nextSponsor,
          }),
          updated: true,
        }),
      );

      const persisted = Option.getOrThrow(yield* browserKeyStore.readSealed());

      expect(persisted.envelope).toEqual(beforeEnvelope);

      const reopened = yield* reopenLocalEnvelope(
        observingCeremony,
        relyingParty,
        persisted.credential,
        persisted.envelope,
        {
          network,
          address: persisted.public.address,
          purpose: "approval",
        },
      );

      assertTagged(reopened, "PhraseOpened");
      expect(Redacted.value(reopened.phrase)).toBe(disposable.phrase);
    }),
);

it.effect("applies overlapping public updates without losing either", () =>
  Effect.gen(function* () {
    yield* Effect.promise(clearDatabase);

    const disposable = yield* enrollDisposableWallet();

    yield* browserKeyStore.installSealed(disposable.record);

    const bumpRevision = (current: PublicDeviceWallet) =>
      Option.some(
        new PublicDeviceWallet({
          ...current,
          transferRevision: (current.transferRevision ?? 0) + 1,
        }),
      );

    yield* Effect.all(
      [
        browserKeyStore.updatePublic(bumpRevision),
        browserKeyStore.updatePublic(bumpRevision),
      ],
      { concurrency: "unbounded" },
    );

    expect(
      Option.getOrThrow(yield* browserKeyStore.readPublic()).transferRevision,
    ).toBe(2);
  }),
);

it.effect(
  "treats a v1 wallet record with a colocated wrapping key as empty without upgrading it",
  () =>
    Effect.gen(function* () {
      yield* Effect.promise(clearDatabase);

      const disposable = yield* enrollDisposableWallet();

      const raw = {
        address: disposable.address,
        username: disposable.publicWallet.username,
        iv: Buffer.alloc(12, 1).toString("base64"),
        phrase: Buffer.alloc(32, 2).toString("base64"),
      };

      const legacyKey = yield* Effect.promise(() =>
        crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
          "encrypt",
          "decrypt",
        ]),
      );

      yield* Effect.promise(() => putRawEntry("wallet", raw));
      yield* Effect.promise(() => putRawEntry("wrapping-key", legacyKey));

      expect(yield* browserKeyStore.readPublic()).toEqual(Option.none());
      expect(yield* browserKeyStore.readSealed()).toEqual(Option.none());
      expect(yield* Effect.promise(() => storedEntry("wallet"))).toEqual(raw);

      yield* browserKeyStore.writeSealed(disposable.record);

      expect(yield* Effect.promise(storedKeys)).toEqual(["wallet"]);
      expect(yield* browserKeyStore.readPublic()).toEqual(
        Option.some(disposable.publicWallet),
      );
    }),
);

it.effect(
  "fails with CorruptDeviceWallet on a damaged pinned credential and keeps the record",
  () =>
    Effect.gen(function* () {
      yield* Effect.promise(clearDatabase);

      const disposable = yield* enrollDisposableWallet();
      const encoded = Schema.encodeSync(SealedDeviceWallet)(disposable.record);

      const raw = {
        ...encoded,
        credential: { ...encoded.credential, algorithm: "HS256" },
      };

      yield* Effect.promise(() => putRawEntry("wallet", raw));

      expect((yield* browserKeyStore.readSealed().pipe(Effect.flip))._tag).toBe(
        "CorruptDeviceWallet",
      );
      expect(
        (yield* browserKeyStore
          .updatePublic((current) => Option.some(current))
          .pipe(Effect.flip))._tag,
      ).toBe("CorruptDeviceWallet");
      expect(yield* Effect.promise(() => storedEntry("wallet"))).toEqual(raw);
    }),
);

it.effect(
  "replaces an installed wallet only for the same address and never a different wallet",
  () =>
    Effect.gen(function* () {
      yield* Effect.promise(clearDatabase);

      const first = yield* enrollDisposableWallet("maria");
      const other = yield* enrollDisposableWallet("otro");

      expect(yield* browserKeyStore.installSealed(first.record)).toBe(true);
      expect(
        yield* browserKeyStore.installSealed(other.record, "same-address"),
      ).toBe(false);
      expect(yield* browserKeyStore.readSealed()).toEqual(
        Option.some(first.record),
      );

      const reserveSponsor = other.address;

      yield* browserKeyStore.updatePublic((current) =>
        Option.some(new PublicDeviceWallet({ ...current, reserveSponsor })),
      );

      const reinstalled = yield* sealLocalEnvelope(
        {
          phrase: first.phrase,
          network,
          address: first.address,
          credentialId: other.credential.id,
          salt: other.salt,
        },
        other.prf,
      );

      assertTagged(reinstalled, "EnvelopeSealed");

      const candidate = new SealedDeviceWallet({
        ...first.record,
        credential: other.credential,
        envelope: reinstalled.envelope,
      });

      expect(yield* browserKeyStore.installSealed(candidate)).toBe(false);
      expect(
        yield* browserKeyStore.installSealed(candidate, "same-address"),
      ).toBe(true);

      const installed = Option.getOrThrow(yield* browserKeyStore.readSealed());

      expect(installed.credential.id).toBe(other.credential.id);
      expect(installed.public.reserveSponsor).toBe(reserveSponsor);

      const spliced = Schema.encodeSync(SealedDeviceWallet)(
        new SealedDeviceWallet({ ...first.record, envelope: other.envelope }),
      );

      yield* Effect.promise(() => putRawEntry("wallet", spliced));
      expect(
        yield* Effect.flip(
          browserKeyStore.installSealed(candidate, "same-address"),
        ),
      ).toBeInstanceOf(CorruptDeviceWallet);
      expect(yield* Effect.promise(() => storedEntry("wallet"))).toEqual(
        spliced,
      );
    }),
);
