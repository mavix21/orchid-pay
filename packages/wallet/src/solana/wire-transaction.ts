import {
  type Address,
  type ReadonlyUint8Array,
  fixDecoderSize,
  fixEncoderSize,
  getArrayDecoder,
  getArrayEncoder,
  getBytesDecoder,
  getBytesEncoder,
  getCompiledTransactionMessageDecoder,
  getShortU16Decoder,
  getShortU16Encoder,
  getStructDecoder,
  getStructEncoder,
} from "@solana/kit";

export interface WireTransaction {
  readonly signatures: ReadonlyArray<ReadonlyUint8Array>;
  readonly messageBytes: ReadonlyUint8Array;
}

const signatureLength = 64;

const encoder = getStructEncoder([
  [
    "signatures",
    getArrayEncoder(fixEncoderSize(getBytesEncoder(), signatureLength), {
      size: getShortU16Encoder(),
    }),
  ],
  ["messageBytes", getBytesEncoder()],
]);

const decoder = getStructDecoder([
  [
    "signatures",
    getArrayDecoder(fixDecoderSize(getBytesDecoder(), signatureLength), {
      size: getShortU16Decoder(),
    }),
  ],
  ["messageBytes", getBytesDecoder()],
]);

const messageDecoder = getCompiledTransactionMessageDecoder();

export const encodeWireTransaction = ({
  signatures,
  messageBytes,
}: WireTransaction) =>
  encoder.encode({ signatures: [...signatures], messageBytes });

export const signersOf = (
  messageBytes: ReadonlyUint8Array,
): ReadonlyArray<Address> => {
  const { header, staticAccounts } = messageDecoder.decode(messageBytes);

  return staticAccounts.slice(0, header.numSignerAccounts);
};

export const holderOf = (transactionBytes: ReadonlyUint8Array) =>
  signersOf(decoder.decode(transactionBytes).messageBytes)[1];
