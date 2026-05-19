export function longFromBytesToUnsigned(source: Uint8Array, i = 0) {
  return Number(
    new DataView(source.buffer, source.byteOffset + i, 8).getBigUint64(0, true),
  )
}
