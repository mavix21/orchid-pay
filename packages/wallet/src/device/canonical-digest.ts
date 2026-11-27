import * as Effect from "effect/Effect";

export const canonicalTuple = (
  parts: ReadonlyArray<Uint8Array>,
): Uint8Array<ArrayBuffer> => {
  const totalLength = parts.reduce((sum, part) => sum + 4 + part.byteLength, 0);

  const buffer = new ArrayBuffer(totalLength);
  const output = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;

  for (const part of parts) {
    view.setUint32(offset, part.byteLength, false);
    offset += 4;
    output.set(part, offset);
    offset += part.byteLength;
  }

  return output;
};

export const sha256 = (bytes: Uint8Array<ArrayBuffer>) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", bytes)).pipe(
    Effect.map((digest) => new Uint8Array(digest)),
  );
