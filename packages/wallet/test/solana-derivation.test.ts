import { expect, it } from "@effect/vitest";
import { mnemonicToSeedSync } from "@scure/bip39";
import { HDKey } from "micro-key-producer/slip10.js";
import {
  base58AddressOf,
  solanaSigningScheme,
} from "../src/solana/signing-scheme";
import { knownPhrase } from "./device-fixtures";

it("derives the address solana-keygen recovers for the same phrase", () => {
  const { publicKeyRaw } = HDKey.fromMasterSeed(
    mnemonicToSeedSync(knownPhrase),
  ).derive(solanaSigningScheme.derivationPath);

  expect(base58AddressOf(publicKeyRaw)).toBe(
    "EfMyugvKBr7JPsxFTUE7Z67sBNJj9NWCRbyt9p7fojBN",
  );
});
