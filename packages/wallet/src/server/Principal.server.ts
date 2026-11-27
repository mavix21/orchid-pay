import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import {
  type AccountAddress,
  type Approval,
  type AssetOrder,
  type CredentialId,
  RateLimited,
  SessionRequired,
} from "../contract";
import { Directory, type StoreFailure } from "./Directory.server";
import { RateLimits } from "./RateLimits.server";
import { WalletSettings } from "./settings.server";
import {
  type SessionClaims,
  mintedClaims,
  openToken,
  sealToken,
  slidClaims,
} from "./session-token.server";

export const SessionCookie = Context.Reference<Option.Option<string>>(
  "@workspace/wallet/server/SessionCookie",
  { defaultValue: () => Option.none() },
);

export const ClientAddress = Context.Reference<Option.Option<string>>(
  "@workspace/wallet/server/ClientAddress",
  { defaultValue: () => Option.none() },
);

export interface SessionGrant {
  readonly token: string;
  readonly expiresAt: number;
}

export class Principal extends Context.Service<
  Principal,
  {
    grant(
      address: AccountAddress,
      credentialId: CredentialId,
    ): Effect.Effect<void>;
    speaksFor(
      address: AccountAddress,
    ): Effect.Effect<void, SessionRequired | RateLimited>;
    admitsDrafting(
      order: AssetOrder,
      approval: Option.Option<Approval>,
    ): Effect.Effect<void, SessionRequired | RateLimited | StoreFailure>;
    readonly admitsPublicCall: Effect.Effect<void, RateLimited>;
    readonly issued: Effect.Effect<Option.Option<SessionGrant>>;
  }
>()("@workspace/wallet/server/Principal") {
  static readonly layer = Layer.effect(
    Principal,
    Effect.gen(function* () {
      const settings = yield* WalletSettings;
      const directory = yield* Directory;
      const limits = yield* RateLimits;
      const pending = yield* Ref.make(Option.none<SessionClaims>());

      const presented = Effect.gen(function* () {
        const cookie = yield* SessionCookie;

        if (Option.isNone(cookie)) return Option.none<SessionClaims>();

        return yield* openToken(
          settings.sessionSecret,
          cookie.value,
          yield* Clock.currentTimeMillis,
        );
      });

      const grant = Effect.fn("Principal.grant")(function* (
        address: AccountAddress,
        credentialId: CredentialId,
      ) {
        yield* Ref.set(
          pending,
          Option.some(
            mintedClaims(address, credentialId, yield* Clock.currentTimeMillis),
          ),
        );
      });

      const recognises = Effect.fn("Principal.recognises")(function* (
        address: AccountAddress,
      ) {
        const claims = yield* presented;

        if (Option.isNone(claims) || claims.value.address !== address)
          return yield* new SessionRequired();

        const slid = slidClaims(claims.value, yield* Clock.currentTimeMillis);

        if (Option.isSome(slid))
          yield* Ref.update(pending, (current) =>
            Option.isSome(current) ? current : slid,
          );
      });

      const withinPrincipalLimit = Effect.fn("Principal.withinPrincipalLimit")(
        function* (address: AccountAddress) {
          if (yield* limits.admitsPrincipal(address)) return;

          yield* Effect.logWarning("Principal rate limit reached");

          return yield* new RateLimited();
        },
      );

      const admitsPublicCall = Effect.gen(function* () {
        const clientAddress = yield* ClientAddress;

        if (Option.isNone(clientAddress)) return;

        if (yield* limits.admitsClient(clientAddress.value)) return;

        yield* Effect.logWarning("Client rate limit reached");

        return yield* new RateLimited();
      });

      const speaksFor = Effect.fn("Principal.speaksFor")(function* (
        address: AccountAddress,
      ) {
        yield* recognises(address);
        yield* withinPrincipalLimit(address);
      });

      const isOpening = Effect.fn("Principal.isOpening")(function* (
        address: AccountAddress,
      ) {
        const row = yield* directory.byAddress(address);

        return Option.exists(row, (wallet) => wallet.status === "opening");
      });

      const admitsDrafting = Effect.fn("Principal.admitsDrafting")(function* (
        order: AssetOrder,
        approval: Option.Option<Approval>,
      ) {
        const refusal = yield* recognises(order.wallet).pipe(
          Effect.flip,
          Effect.option,
        );

        if (Option.isNone(refusal))
          return yield* withinPrincipalLimit(order.wallet);

        const draftsWithoutSession =
          Predicate.isTagged(order.action, "ReceiveLink") &&
          Option.isNone(approval);

        if (!draftsWithoutSession) return yield* refusal.value;

        yield* admitsPublicCall;

        if (!(yield* isOpening(order.wallet))) return yield* refusal.value;
      });

      const issued = Effect.gen(function* () {
        const claims = yield* Ref.get(pending);

        return yield* Option.match(claims, {
          onNone: () => Effect.succeed(Option.none<SessionGrant>()),
          onSome: (granted) =>
            sealToken(settings.sessionSecret, granted).pipe(
              Effect.map((token) =>
                Option.some({ token, expiresAt: granted.expiresAt }),
              ),
            ),
        });
      });

      return Principal.of({
        grant,
        speaksFor,
        admitsDrafting,
        admitsPublicCall,
        issued,
      });
    }),
  );
}
