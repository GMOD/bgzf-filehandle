export function concatUint8Arrays(arrays: Uint8Array[], totalLength?: number) {
  if (arrays.length === 0) {
    return new Uint8Array(0)
  }

  totalLength ??= arrays.reduce(
    (accumulator, currentValue) => accumulator + currentValue.length,
    0,
  )

  const returnValue = new Uint8Array(totalLength)

  let offset = 0
  for (const array of arrays) {
    returnValue.set(array, offset)
    offset += array.length
  }

  return returnValue
}
