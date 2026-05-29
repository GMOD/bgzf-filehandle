// Reads a little-endian unsigned 64-bit integer as a JS number. Exact for
// values up to Number.MAX_SAFE_INTEGER (2^53-1, ~9PB), matching the precision
// of the previous BigInt->Number path without allocating a BigInt per call.
export function readUint64LE(view: DataView, offset = 0) {
  const lo = view.getUint32(offset, true)
  const hi = view.getUint32(offset + 4, true)
  return hi * 0x1_0000_0000 + lo
}
