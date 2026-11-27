import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { AccountAddress } from "../contract";

export class RateLimits extends Context.Service<
  RateLimits,
  {
    admitsPrincipal(address: AccountAddress): Effect.Effect<boolean>;
    admitsClient(clientAddress: string): Effect.Effect<boolean>;
  }
>()("@workspace/wallet/server/RateLimits") {
  static readonly unlimited = Layer.succeed(RateLimits, {
    admitsPrincipal: () => Effect.succeed(true),
    admitsClient: () => Effect.succeed(true),
  });
}
