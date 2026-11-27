import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import type * as Redacted from "effect/Redacted";

export const defaultRpcTimeout = Duration.seconds(10);

export const rpcReadConcurrency = 4;

export class WalletSettings extends Context.Service<
  WalletSettings,
  {
    readonly rpcUrl: string;
    readonly rpcTimeout?: Duration.Input;
    readonly reserveSponsorSecret: Redacted.Redacted<string>;
    readonly feePayerSecret: Redacted.Redacted<string>;
    readonly passkeyOrigins: ReadonlyArray<string>;
    readonly humanCheckSecret: Redacted.Redacted<string>;
    readonly sessionSecret: Redacted.Redacted<string>;
  }
>()("@workspace/wallet/server/WalletSettings") {}
