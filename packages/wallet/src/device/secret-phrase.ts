import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as Schema from "effect/Schema";

export const SecretPhrase = Schema.String.check(
  Schema.makeFilter((value) => validateMnemonic(value, wordlist)),
).pipe(Schema.brand("SecretPhrase"));

export type SecretPhrase = typeof SecretPhrase.Type;

export function generateSecretPhrase(): SecretPhrase {
  return Schema.decodeSync(SecretPhrase)(generateMnemonic(wordlist, 128));
}
