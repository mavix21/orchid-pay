import { Keypair, hash } from "@stellar/stellar-sdk";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { AccountAddress } from "../contract";

export const sandboxPartnerKeypair = (feePayer: Keypair) =>
  Keypair.fromRawEd25519Seed(
    hash(
      Buffer.concat([
        feePayer.rawSecretKey(),
        Buffer.from("orchid sandbox payout partner"),
      ]),
    ),
  );

export const stellarSandboxDepositAddress = ({
  feePayerSecret,
}: {
  readonly feePayerSecret: Redacted.Redacted<string>;
}): AccountAddress =>
  Schema.decodeSync(AccountAddress)(
    sandboxPartnerKeypair(
      Keypair.fromSecret(Redacted.value(feePayerSecret)),
    ).publicKey(),
  );
