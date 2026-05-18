export function concatUint8Array(args: Uint8Array[]) {
  let total = 0
  for (const entry of args) {
    total += entry.length
  }
  const mergedArray = new Uint8Array(total)
  let offset = 0
  for (const entry of args) {
    mergedArray.set(entry, offset)
    offset += entry.length
  }
  return mergedArray
}
