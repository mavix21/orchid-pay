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

export interface SolanaSealedEnvelope {
  readonly lastValidBlockHeight: bigint;
  readonly draftedSlot: bigint;
  readonly transactionBytes: ReadonlyUint8Array;
}

const codecOf = <Field extends string>(version: number, bytesField: Field) => {
  const tag = new Uint8Array([version]);

  return {
    encoder: getHiddenPrefixEncoder(
      getStructEncoder([
        ["lastValidBlockHeight", getU64Encoder()],
        ["draftedSlot", getU64Encoder()],
        [bytesField, getBytesEncoder()],
      ]),
      [getConstantEncoder(tag)],
    ),
    decoder: getHiddenPrefixDecoder(
      getStructDecoder([
        ["lastValidBlockHeight", getU64Decoder()],
        ["draftedSlot", getU64Decoder()],
        [bytesField, getBytesDecoder()],
      ]),
      [getConstantDecoder(tag)],
    ),
  };
};

const { encoder, decoder } = codecOf(1, "messageBytes");

const sealedCodec = codecOf(2, "transactionBytes");

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

export const encodeSealedEnvelope = (envelope: SolanaSealedEnvelope) =>
  base64Decoder.decode(sealedCodec.encoder.encode(envelope));

export const decodeSealedEnvelope: (
  envelope: string,
) => Option.Option<SolanaSealedEnvelope> = Option.liftThrowable(
  (envelope: string) =>
    sealedCodec.decoder.decode(base64Encoder.encode(envelope)),
);
