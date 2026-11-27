import {
  type ReadonlyUint8Array,
  getBase64Decoder,
  getBase64Encoder,
  getBytesDecoder,
  getBytesEncoder,
  getConstantDecoder,
  getConstantEncoder,
  getHiddenPrefixDecoder,
  getHiddenPrefixEncoder,
  getStructDecoder,
  getStructEncoder,
  getU64Decoder,
  getU64Encoder,
} from "@solana/kit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { UnsignedEnvelope } from "../contract";

export interface SolanaEnvelope {
  readonly lastValidBlockHeight: bigint;
  readonly draftedSlot: bigint;
  readonly messageBytes: ReadonlyUint8Array;
}

const version = new Uint8Array([1]);

const encoder = getHiddenPrefixEncoder(
  getStructEncoder([
    ["lastValidBlockHeight", getU64Encoder()],
    ["draftedSlot", getU64Encoder()],
    ["messageBytes", getBytesEncoder()],
  ]),
  [getConstantEncoder(version)],
);

const decoder = getHiddenPrefixDecoder(
  getStructDecoder([
    ["lastValidBlockHeight", getU64Decoder()],
    ["draftedSlot", getU64Decoder()],
    ["messageBytes", getBytesDecoder()],
  ]),
  [getConstantDecoder(version)],
);

const base64Encoder = getBase64Encoder();
const base64Decoder = getBase64Decoder();

export const encodeEnvelope = (envelope: SolanaEnvelope): UnsignedEnvelope =>
  Schema.decodeSync(UnsignedEnvelope)(
    base64Decoder.decode(encoder.encode(envelope)),
  );

export const decodeEnvelope: (
  envelope: UnsignedEnvelope,
) => Option.Option<SolanaEnvelope> = Option.liftThrowable(
  (envelope: UnsignedEnvelope) =>
    decoder.decode(base64Encoder.encode(envelope)),
);
