import { Keypair, hash } from "@stellar/stellar-sdk";

export const sandboxPartnerKeypair = (feePayer: Keypair) =>
  Keypair.fromRawEd25519Seed(
    hash(
      Buffer.concat([
        feePayer.rawSecretKey(),
        Buffer.from("orchid sandbox payout partner"),
      ]),
    ),
  );
