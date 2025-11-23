import { Inflate, Z_SYNC_FLUSH } from 'pako-esm2'

import { concatUint8Array } from './util.ts'

function parseGzipHeader(data: Uint8Array) {
  let offset = 10
  const flags = data[3]!

  if (flags & 0x04) {
    const xlen = data[offset]! | (data[offset + 1]! << 8)
    offset += 2 + xlen
  }
  if (flags & 0x08) {
    while (data[offset++] !== 0) {}
  }
  if (flags & 0x10) {
    while (data[offset++] !== 0) {}
  }
  if (flags & 0x02) {
    offset += 2
  }
  return offset
}

// Type for the block cache
export interface BlockCache {
  get(key: string): { buffer: Uint8Array; nextIn: number } | undefined
  set(key: string, value: { buffer: Uint8Array; nextIn: number }): void
}

interface VirtualOffset {
  blockPosition: number
  dataPosition: number
}
interface Chunk {
  minv: VirtualOffset
  maxv: VirtualOffset
}

// browserify-zlib, which is the zlib shim used by default in webpacked code,
// does not properly uncompress bgzf chunks that contain more than one bgzf
// block, so export an unzip function that uses @progress/pako-esm2 directly if we are running
// in a browser.
export async function unzip(inputData: Uint8Array) {
  try {
    let pos = 0
    let inflator
    const blocks = [] as Uint8Array[]
    let totalLength = 0
    do {
      const remainingInput = inputData.subarray(pos)
      const headerSize = parseGzipHeader(remainingInput)
      const blockSize = (remainingInput[16]! | (remainingInput[17]! << 8)) + 1
      const deflateData = remainingInput.subarray(headerSize, blockSize - 8)

      inflator = new Inflate({ raw: true })
      inflator.push(deflateData, Z_SYNC_FLUSH)
      if (inflator.err) {
        throw new Error(inflator.msg)
      }

      pos += blockSize
      const result = inflator.result as Uint8Array
      blocks.push(result)
      totalLength += result.length
    } while (pos < inputData.length)

    return concatUint8Array(blocks, totalLength)
  } catch (e) {
    throw new Error(`problem decompressing block`, { cause: e })
  }
}

// keeps track of the position of compressed blocks in terms of file offsets,
// and a decompressed equivalent
//
// also slices (0,minv.dataPosition) and (maxv.dataPosition,end) off
export async function unzipChunkSlice(
  inputData: Uint8Array,
  chunk: Chunk,
  blockCache?: BlockCache,
) {
  try {
    const { minv, maxv } = chunk
    let cpos = minv.blockPosition
    let dpos = minv.dataPosition
    const chunks = [] as Uint8Array[]
    const cpositions = [] as number[]
    const dpositions = [] as number[]

    let i = 0
    let totalLength = 0
    do {
      const remainingInput = inputData.subarray(cpos - minv.blockPosition)
      const cacheKey = cpos.toString()

      let buffer: Uint8Array
      let nextIn: number

      // Check cache first
      const cached = blockCache?.get(cacheKey)
      if (cached) {
        buffer = cached.buffer
        nextIn = cached.nextIn
      } else {
        // Not in cache, decompress and store
        const headerSize = parseGzipHeader(remainingInput)
        const blockSize = (remainingInput[16]! | (remainingInput[17]! << 8)) + 1
        const deflateData = remainingInput.subarray(headerSize, blockSize - 8)

        const inflator = new Inflate({ raw: true })
        inflator.push(deflateData, Z_SYNC_FLUSH)
        if (inflator.err) {
          throw new Error(inflator.msg)
        }

        buffer = inflator.result as Uint8Array
        nextIn = blockSize

        // Cache the decompressed block
        blockCache?.set(cacheKey, { buffer, nextIn })
      }

      chunks.push(buffer)
      let len = buffer.length

      cpositions.push(cpos)
      dpositions.push(dpos)
      if (chunks.length === 1 && minv.dataPosition) {
        // this is the first chunk, trim it
        chunks[0] = chunks[0]!.subarray(minv.dataPosition)
        len = chunks[0].length
      }
      const origCpos = cpos
      cpos += nextIn
      dpos += len

      if (origCpos >= maxv.blockPosition) {
        // this is the last chunk, trim it and stop decompressing. note if it is
        // the same block is minv it subtracts that already trimmed part of the
        // slice length
        chunks[i] = chunks[i]!.subarray(
          0,
          maxv.blockPosition === minv.blockPosition
            ? maxv.dataPosition - minv.dataPosition + 1
            : maxv.dataPosition + 1,
        )
        totalLength += chunks[i]!.length

        cpositions.push(cpos)
        dpositions.push(dpos)
        break
      }
      totalLength += len
      i++
    } while (cpos < inputData.length + minv.blockPosition)

    return {
      buffer: concatUint8Array(chunks, totalLength),
      cpositions,
      dpositions,
    }
  } catch (e) {
    throw new Error(`problem decompressing block`, { cause: e })
  }
}
