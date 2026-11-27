import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { PasskeyChallenge } from "../src/contract";
import {
  type AssertionCeremony,
  AssertionIntent,
  PinnedCredential,
  verifyPinnedAssertion,
} from "../src/device/assertion";
import { SoftwareAuthenticator } from "./software-authenticator";
import { assertTagged } from "./tagged";

const relyingParty = { origin: "http://localhost:3000", rpId: "localhost" };

const bytes = (label: string) => Uint8Array.from(Buffer.from(label));

const challenge = Schema.decodeSync(PasskeyChallenge)("A".repeat(43));

const enrolled = Effect.sync(() => {
  const auth = new SoftwareAuthenticator(relyingParty.origin);

  const registered = Option.getOrThrow(
    auth.enrollWithPrf(challenge, bytes("registration")),
  );

  return {
    auth,
    credential: new PinnedCredential({
      id: registered.registration.id,
      publicKey: registered.registration.publicKey,
      algorithm: "ES256",
    }),
  };
});

const approval = (first: string, second?: string) =>
  AssertionIntent.Operation({
    purpose: "approval",
    prf: {
      first: bytes(first),
      second: Option.fromNullishOr(second).pipe(Option.map(bytes)),
    },
  });

const withoutSecondOutput = (
  ceremony: AssertionCeremony,
): AssertionCeremony => ({
  assert: (request) =>
    ceremony.assert(request).pipe(
      Effect.map((platform) => ({
        ...platform,
        prf: { ...platform.prf, second: Option.none() },
      })),
    ),
});

const rejectedCeremonies = [
  [
    "a replayed assertion",
    (auth: SoftwareAuthenticator, credential: PinnedCredential) =>
      Effect.gen(function* () {
        yield* verifyPinnedAssertion(
          auth.assertions,
          relyingParty,
          credential,
          AssertionIntent.Entry(),
        );

        const captured = auth.issued[0];

        if (captured === undefined) throw new Error("No assertion captured");

        const replay: AssertionCeremony = {
          assert: () =>
            Effect.succeed({
              assertion: captured,
              prf: { first: Option.none(), second: Option.none() },
            }),
        };

        return replay;
      }),
  ],
  [
    "a different key behind the pinned credential ID",
    (auth: SoftwareAuthenticator, credential: PinnedCredential) =>
      Effect.sync(() => {
        auth.forge(credential.id);

        return auth.assertions;
      }),
  ],
  [
    "another origin",
    (auth: SoftwareAuthenticator) =>
      Effect.sync(() => {
        auth.origin = "http://localhost:4000";

        return auth.assertions;
      }),
  ],
  [
    "an assertion without user verification",
    (auth: SoftwareAuthenticator) =>
      Effect.sync(() => {
        auth.userVerified = false;

        return auth.assertions;
      }),
  ],
] as const;

it.effect(
  "accepts a zero-counter entry assertion without PRF and releases operation outputs",
  () =>
    Effect.gen(function* () {
      const { auth, credential } = yield* enrolled;

      const entry = yield* verifyPinnedAssertion(
        auth.assertions,
        relyingParty,
        credential,
        AssertionIntent.Entry(),
      );

      const operation = yield* verifyPinnedAssertion(
        auth.assertions,
        relyingParty,
        credential,
        approval("wallet", "link"),
      );

      const wallet = Option.getOrThrow(
        yield* auth.passkeys.authenticate(challenge, bytes("wallet")),
      ).prf;

      const link = Option.getOrThrow(
        yield* auth.passkeys.authenticate(challenge, bytes("link")),
      ).prf;

      const counter = Buffer.from(
        auth.issued[0]?.authenticatorData ?? "",
        "base64url",
      ).readUInt32BE(33);

      assertTagged(entry, "EntryVerified");
      assertTagged(operation, "OperationVerified");
      expect(counter).toBe(0);
      expect(auth.requested[0]).toEqual(Option.none());
      expect(Redacted.value(operation.prf.first)).toEqual(wallet);
      expect(Option.map(operation.prf.second, Redacted.value)).toEqual(
        Option.some(link),
      );
    }),
);

it.effect.each(rejectedCeremonies)(
  "rejects %s and wipes any PRF output it returned",
  ([, tamper]) =>
    Effect.gen(function* () {
      const { auth, credential } = yield* enrolled;
      const ceremony = yield* tamper(auth, credential);
      const returned: Array<Uint8Array> = [];

      const capturing: AssertionCeremony = {
        assert: (request) =>
          ceremony.assert(request).pipe(
            Effect.tap((platform) =>
              Effect.sync(() => {
                returned.push(
                  ...Option.toArray(platform.prf.first),
                  ...Option.toArray(platform.prf.second),
                );
              }),
            ),
          ),
      };

      const outcome = yield* verifyPinnedAssertion(
        capturing,
        relyingParty,
        credential,
        approval("wallet"),
      );

      expect(outcome._tag).toBe("AssertionRejected");
      expect(returned.filter((output) => output.some(Boolean))).toEqual([]);
    }),
);

it.effect(
  "reports cancellation, a wrong credential, a missing wallet output and a missing operation output distinctly",
  () =>
    Effect.gen(function* () {
      const cancelling = yield* enrolled;

      cancelling.auth.cancels = true;

      const cancelled = yield* verifyPinnedAssertion(
        cancelling.auth.assertions,
        relyingParty,
        cancelling.credential,
        AssertionIntent.Entry(),
      ).pipe(Effect.flip);

      const swapping = yield* enrolled;

      swapping.auth.forge("b3RoZXI");

      const wrongCredential = yield* verifyPinnedAssertion(
        swapping.auth.assertions,
        relyingParty,
        swapping.credential,
        AssertionIntent.Entry(),
      );

      const withoutPrf = yield* enrolled;

      withoutPrf.auth.prf = false;

      const missingOutput = yield* verifyPinnedAssertion(
        withoutPrf.auth.assertions,
        relyingParty,
        withoutPrf.credential,
        approval("wallet"),
      );

      const partial = yield* enrolled;

      const missingSecondOutput = yield* verifyPinnedAssertion(
        withoutSecondOutput(partial.auth.assertions),
        relyingParty,
        partial.credential,
        approval("wallet", "link"),
      );

      expect(cancelled._tag).toBe("PasskeyCancelled");
      expect(wrongCredential._tag).toBe("WrongCredential");
      expect(missingOutput._tag).toBe("PrfOutputMissing");
      assertTagged(missingSecondOutput, "OperationVerified");
      expect(missingSecondOutput.prf.second).toEqual(Option.none());
    }),
);
