import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { AccountAddress, CredentialId } from "../contract";
import { network } from "../record-network";

const day = 24 * 60 * 60 * 1000;

const sessionIdleLifetime = 30 * day;

const sessionHardCap = 90 * day;

const sessionRenewalStep = day;

export class SessionClaims extends Schema.Class<SessionClaims>(
  "@workspace/wallet/SessionClaims",
)({
  version: Schema.Literal(1),
  network: Schema.Literal(network),
  address: AccountAddress,
  credentialId: CredentialId,
  mintedAt: Schema.Int,
  expiresAt: Schema.Int,
}) {}

export const mintedClaims = (
  address: AccountAddress,
  credentialId: CredentialId,
  now: number,
) =>
  new SessionClaims({
    version: 1,
    network,
    address,
    credentialId,
    mintedAt: now,
    expiresAt: now + sessionIdleLifetime,
  });

export const slidClaims = (claims: SessionClaims, now: number) => {
  const expiresAt = Math.min(
    now + sessionIdleLifetime,
    claims.mintedAt + sessionHardCap,
  );

  return expiresAt - claims.expiresAt >= sessionRenewalStep
    ? Option.some(new SessionClaims({ ...claims, expiresAt }))
    : Option.none<SessionClaims>();
};

const ClaimsJson = Schema.fromJsonString(SessionClaims);

const encoder = new TextEncoder();

const encodeText = Schema.encodeSync(Schema.StringFromBase64Url);

const decodeText = Schema.decodeUnknownOption(Schema.StringFromBase64Url);

const encodeBytes = Schema.encodeSync(Schema.Uint8ArrayFromBase64Url);

const decodeBytes = Schema.decodeUnknownOption(Schema.Uint8ArrayFromBase64Url);

const macKey = (secret: Redacted.Redacted<string>, usage: KeyUsage) =>
  Effect.promise(() =>
    crypto.subtle.importKey(
      "raw",
      encoder.encode(Redacted.value(secret)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      [usage],
    ),
  );

export const sealToken = Effect.fn("Session.sealToken")(function* (
  secret: Redacted.Redacted<string>,
  claims: SessionClaims,
) {
  const payload = encodeText(Schema.encodeSync(ClaimsJson)(claims));
  const key = yield* macKey(secret, "sign");

  const mac = yield* Effect.promise(() =>
    crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
  );

  return `${payload}.${encodeBytes(new Uint8Array(mac))}`;
});

export const openToken = Effect.fn("Session.openToken")(function* (
  secret: Redacted.Redacted<string>,
  token: string,
  now: number,
) {
  const [payload, mac, ...rest] = token.split(".");

  if (payload === undefined || mac === undefined || rest.length > 0)
    return Option.none<SessionClaims>();

  const macBytes = decodeBytes(mac);

  if (Option.isNone(macBytes)) return Option.none<SessionClaims>();

  const key = yield* macKey(secret, "verify");

  const authentic = yield* Effect.promise(() =>
    crypto.subtle.verify(
      "HMAC",
      key,
      Uint8Array.from(macBytes.value),
      encoder.encode(payload),
    ),
  );

  if (!authentic) return Option.none<SessionClaims>();

  return decodeText(payload).pipe(
    Option.flatMap(Schema.decodeUnknownOption(ClaimsJson)),
    Option.filter(
      (claims) =>
        now < claims.expiresAt && now < claims.mintedAt + sessionHardCap,
    ),
  );
});
