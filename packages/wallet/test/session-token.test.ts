import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { AccountAddress, CredentialId } from "../src/contract";
import {
  SessionClaims,
  mintedClaims,
  openToken,
  sealToken,
  slidClaims,
} from "../src/server/session-token.server";
import { randomKey } from "./test-keys";

const day = 24 * 60 * 60 * 1000;
const idleLifetime = 30 * day;
const hardCap = 90 * day;
const secret = Redacted.make("session-secret");
const address = Schema.decodeSync(AccountAddress)(randomKey().publicKey());
const credentialId = Schema.decodeSync(CredentialId)("Y3JlZGVudGlhbA");
const mintedAt = Date.UTC(2026, 10, 25);

const minted = mintedClaims(address, credentialId, mintedAt);

const replaceFirstCharacter = (value: string) =>
  `${value.startsWith("A") ? "B" : "A"}${value.slice(1)}`;

it.effect("refuses a token whose payload or signature was altered", () =>
  Effect.gen(function* () {
    const token = yield* sealToken(secret, minted);
    const [payload = "", mac = ""] = token.split(".");

    expect(Option.isSome(yield* openToken(secret, token, mintedAt))).toBe(true);
    expect(
      yield* openToken(
        secret,
        `${replaceFirstCharacter(payload)}.${mac}`,
        mintedAt,
      ),
    ).toEqual(Option.none());
    expect(
      yield* openToken(
        secret,
        `${payload}.${replaceFirstCharacter(mac)}`,
        mintedAt,
      ),
    ).toEqual(Option.none());
    expect(
      yield* openToken(Redacted.make("another-secret"), token, mintedAt),
    ).toEqual(Option.none());
  }),
);

it.effect("refuses a token past its idle expiry", () =>
  Effect.gen(function* () {
    const token = yield* sealToken(secret, minted);

    expect(
      Option.isSome(
        yield* openToken(secret, token, mintedAt + idleLifetime - 1),
      ),
    ).toBe(true);
    expect(yield* openToken(secret, token, mintedAt + idleLifetime)).toEqual(
      Option.none(),
    );
  }),
);

it.effect(
  "refuses a token past the hard cap even when its expiry says otherwise, and clamps a slid expiry to the cap",
  () =>
    Effect.gen(function* () {
      const overextended = yield* sealToken(
        secret,
        new SessionClaims({ ...minted, expiresAt: mintedAt + 100 * day }),
      );

      expect(
        Option.isSome(
          yield* openToken(secret, overextended, mintedAt + hardCap - 1),
        ),
      ).toBe(true);
      expect(
        yield* openToken(secret, overextended, mintedAt + hardCap),
      ).toEqual(Option.none());

      const nearTheCap = slidClaims(minted, mintedAt + 80 * day);

      expect(Option.map(nearTheCap, (claims) => claims.expiresAt)).toEqual(
        Option.some(mintedAt + hardCap),
      );
      expect(Option.map(nearTheCap, (claims) => claims.mintedAt)).toEqual(
        Option.some(mintedAt),
      );
    }),
);

it("renews a session only once its token is a day old", () => {
  expect(slidClaims(minted, mintedAt + day - 1)).toEqual(Option.none());
  expect(
    Option.map(
      slidClaims(minted, mintedAt + day),
      (claims) => claims.expiresAt,
    ),
  ).toEqual(Option.some(mintedAt + day + idleLifetime));
});
