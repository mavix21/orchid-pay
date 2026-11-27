import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { HumanCheckRefused, type HumanCheckToken } from "../contract";
import { WalletSettings } from "./settings.server";

const siteverifyUrl =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const siteverifyDeadline = Duration.seconds(5);

const serviceFaults: ReadonlySet<string> = new Set([
  "missing-input-secret",
  "invalid-input-secret",
  "bad-request",
  "internal-error",
]);

export class HumanCheckUnavailable extends Schema.TaggedError<HumanCheckUnavailable>()(
  "HumanCheckUnavailable",
  {},
) {}

const Siteverify = Schema.fromJsonString(
  Schema.Struct({
    success: Schema.Boolean,
    "error-codes": Schema.optional(Schema.Array(Schema.String)),
  }),
);

export type HumanCheckVerdict = Option.Option<HumanCheckRefused>;

export class HumanCheck extends Context.Service<
  HumanCheck,
  {
    verify(
      token: Option.Option<HumanCheckToken>,
    ): Effect.Effect<HumanCheckVerdict, HumanCheckUnavailable>;
  }
>()("@workspace/wallet/server/HumanCheck") {
  static readonly layer = Layer.effect(
    HumanCheck,
    Effect.gen(function* () {
      const { humanCheckSecret } = yield* WalletSettings;
      const client = yield* HttpClient.HttpClient;

      const siteverify = (token: HumanCheckToken) =>
        HttpClientRequest.post(siteverifyUrl).pipe(
          HttpClientRequest.bodyUrlParams({
            secret: Redacted.value(humanCheckSecret),
            response: token,
          }),
          client.execute,
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((response) => response.text),
          Effect.provideService(HttpClient.TracerPropagationEnabled, false),
          Effect.flatMap(Schema.decodeEffect(Siteverify)),
          Effect.timeout(siteverifyDeadline),
          Effect.mapError(() => new HumanCheckUnavailable()),
        );

      const verify = Effect.fn("HumanCheck.verify")(function* (
        token: Option.Option<HumanCheckToken>,
      ): Effect.fn.Return<HumanCheckVerdict, HumanCheckUnavailable> {
        if (Option.isNone(token)) return Option.some(new HumanCheckRefused());

        const reply = yield* siteverify(token.value);

        if (reply.success) return Option.none();

        if (
          (reply["error-codes"] ?? []).some((code) => serviceFaults.has(code))
        )
          return yield* new HumanCheckUnavailable();

        return Option.some(new HumanCheckRefused());
      });

      return HumanCheck.of({ verify });
    }),
  );
}
