import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  Approval,
  AssetOrder,
  AssetOrderId,
  ClaimUnclaimedFunds,
  CredentialId,
  ReceiveLink,
} from "../src/contract";
import {
  ClientAddress,
  Principal,
  SessionCookie,
} from "../src/server/Principal.server";
import { RateLimits } from "../src/server/RateLimits.server";
import { mintedClaims, sealToken } from "../src/server/session-token.server";
import { assertTagged } from "./tagged";
import {
  addressOf,
  claimFor,
  dbLayer,
  fundedWallet,
  opening,
  useDisposableDatabase,
  walletForDb,
  walletTestLayer,
} from "./wallet-harness";
import { randomAddress, randomKey, randomUnclaimedFundsId } from "./test-keys";

const credentialId = Schema.decodeSync(CredentialId)("Y3JlZGVudGlhbA");

const unclaimedFunds = randomUnclaimedFundsId();

const tokenFor = (address: AccountAddress, secret = "session-secret") =>
  sealToken(
    Redacted.make(secret),
    mintedClaims(address, credentialId, Date.now()),
  );

const budget = (allowed: number) => {
  const spendFrom = () => {
    const spent = new Map<string, number>();

    return (key: string) =>
      Effect.sync(() => {
        const total = (spent.get(key) ?? 0) + 1;

        spent.set(key, total);

        return total <= allowed;
      });
  };

  return Layer.succeed(RateLimits, {
    admitsPrincipal: spendFrom(),
    admitsClient: spendFrom(),
  });
};

const atRequest = <A, E>(
  cookie: Option.Option<string>,
  program: Effect.Effect<A, E, Principal>,
  limits: Layer.Layer<RateLimits> = RateLimits.unlimited,
) =>
  program.pipe(
    Effect.provide(Layer.fresh(walletForDb(dbLayer, limits))),
    Effect.provideService(SessionCookie, cookie),
  );

const fromClient = <A, E, R>(
  clientAddress: string,
  program: Effect.Effect<A, E, R>,
) =>
  program.pipe(
    Effect.provideService(ClientAddress, Option.some(clientAddress)),
  );

const speaksFor = (address: AccountAddress) =>
  Principal.use((principal) => principal.speaksFor(address));

const order = (wallet: AccountAddress, action: AssetOrder["action"]) =>
  new AssetOrder({
    id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
    wallet,
    action,
  });

const receiving = (wallet: AccountAddress) =>
  order(wallet, ReceiveLink.make({ link: wallet, unclaimedFunds }));

const signed = Option.some(
  new Approval({
    signature: randomKey().sign(new TextEncoder().encode("approval")),
  }),
);

const refusals = [
  {
    name: "another wallet's address",
    cookie: (own: AccountAddress) => tokenFor(own),
    asking: () => randomAddress(),
  },
  {
    name: "a missing cookie",
    cookie: () => Effect.succeed(undefined),
    asking: (own: AccountAddress) => own,
  },
  {
    name: "a token sealed with another secret",
    cookie: (own: AccountAddress) => tokenFor(own, "another-secret"),
    asking: (own: AccountAddress) => own,
  },
];

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect("answers for the wallet its live session carries", () =>
      Effect.gen(function* () {
        const own = randomAddress();

        const token = yield* tokenFor(own);

        yield* atRequest(Option.some(token), speaksFor(own));
      }),
    );

    it.effect.each(refusals)(
      "refuses $name with SessionRequired",
      ({ cookie, asking }) =>
        Effect.gen(function* () {
          const own = randomAddress();
          const presented = yield* cookie(own);

          const refusal = yield* Effect.flip(
            atRequest(Option.fromNullishOr(presented), speaksFor(asking(own))),
          );

          assertTagged(refusal, "SessionRequired");
        }),
    );

    it.effect(
      "drafts a receive into a wallet still opening without a session, but never with an approval or another action",
      () =>
        Effect.gen(function* () {
          const key = randomKey();
          const wallet = addressOf(key);

          assertTagged(yield* opening(claimFor(key, "nuevo")), "OpeningDraft");

          const refusalOf = (
            drafted: AssetOrder,
            approval: Option.Option<Approval>,
          ) =>
            atRequest(
              Option.none(),
              Principal.use((principal) =>
                principal.admitsDrafting(drafted, approval),
              ),
            ).pipe(Effect.flip, Effect.option);

          expect(yield* refusalOf(receiving(wallet), Option.none())).toEqual(
            Option.none(),
          );

          assertTagged(
            Option.getOrThrow(yield* refusalOf(receiving(wallet), signed)),
            "SessionRequired",
          );
          assertTagged(
            Option.getOrThrow(
              yield* refusalOf(
                order(wallet, ClaimUnclaimedFunds.make({ unclaimedFunds })),
                Option.none(),
              ),
            ),
            "SessionRequired",
          );
        }),
    );

    it.effect(
      "refuses a receive into an active wallet without its session",
      () =>
        Effect.gen(function* () {
          const active = addressOf(yield* fundedWallet("maria"));

          const refusal = yield* Effect.flip(
            atRequest(
              Option.none(),
              Principal.use((principal) =>
                principal.admitsDrafting(receiving(active), Option.none()),
              ),
            ),
          );

          assertTagged(refusal, "SessionRequired");
        }),
    );

    it.effect("meters each verified wallet against its own budget", () =>
      Effect.gen(function* () {
        const limits = budget(2);
        const busy = randomAddress();
        const quiet = randomAddress();
        const busyCookie = Option.some(yield* tokenFor(busy));
        const quietCookie = Option.some(yield* tokenFor(quiet));

        yield* atRequest(busyCookie, speaksFor(busy), limits);
        yield* atRequest(
          busyCookie,
          Principal.use((principal) =>
            principal.admitsDrafting(receiving(busy), Option.none()),
          ),
          limits,
        );

        assertTagged(
          yield* Effect.flip(atRequest(busyCookie, speaksFor(busy), limits)),
          "RateLimited",
        );

        assertTagged(
          yield* Effect.flip(
            atRequest(Option.none(), speaksFor(quiet), limits),
          ),
          "SessionRequired",
        );

        yield* atRequest(quietCookie, speaksFor(quiet), limits);
        yield* atRequest(quietCookie, speaksFor(quiet), limits);
      }),
    );

    it.effect("meters public calls per client and skips unknown clients", () =>
      Effect.gen(function* () {
        const limits = budget(1);

        const admitted = Principal.use(
          (principal) => principal.admitsPublicCall,
        );

        yield* atRequest(
          Option.none(),
          fromClient("203.0.113.7", admitted),
          limits,
        );

        assertTagged(
          yield* Effect.flip(
            atRequest(
              Option.none(),
              fromClient("203.0.113.7", admitted),
              limits,
            ),
          ),
          "RateLimited",
        );

        yield* atRequest(
          Option.none(),
          fromClient("203.0.113.8", admitted),
          limits,
        );
        yield* atRequest(Option.none(), admitted, limits);
        yield* atRequest(Option.none(), admitted, limits);
      }),
    );

    it.effect(
      "meters a sessionless receive draft per client before reading the wallet",
      () =>
        Effect.gen(function* () {
          const limits = budget(1);
          const key = randomKey();
          const wallet = addressOf(key);

          assertTagged(yield* opening(claimFor(key, "paso")), "OpeningDraft");

          const drafting = Principal.use((principal) =>
            principal.admitsDrafting(receiving(wallet), Option.none()),
          );

          yield* atRequest(
            Option.none(),
            fromClient("198.51.100.1", drafting),
            limits,
          );

          assertTagged(
            yield* Effect.flip(
              atRequest(
                Option.none(),
                fromClient("198.51.100.1", drafting),
                limits,
              ),
            ),
            "RateLimited",
          );

          yield* atRequest(
            Option.none(),
            fromClient("198.51.100.2", drafting),
            limits,
          );

          const active = addressOf(yield* fundedWallet("rosa"));

          const intoActive = Principal.use((principal) =>
            principal.admitsDrafting(receiving(active), Option.none()),
          );

          assertTagged(
            yield* Effect.flip(
              atRequest(
                Option.none(),
                fromClient("198.51.100.3", intoActive),
                limits,
              ),
            ),
            "SessionRequired",
          );
          assertTagged(
            yield* Effect.flip(
              atRequest(
                Option.none(),
                fromClient("198.51.100.3", intoActive),
                limits,
              ),
            ),
            "RateLimited",
          );
        }),
    );
  },
);
