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

    let totalLength = 0
    const blockInfo = []
    while (pos < inputData.length) {
      if (pos + 18 > inputData.length) {
        break
      }
      const blockSize = (inputData[pos + 16]! | (inputData[pos + 17]! << 8)) + 1
      if (pos + blockSize > inputData.length) {
        break
      }
      const isize =
        inputData[pos + blockSize - 4]! |
        (inputData[pos + blockSize - 3]! << 8) |
        (inputData[pos + blockSize - 2]! << 16) |
        (inputData[pos + blockSize - 1]! << 24)
      blockInfo.push({ pos, blockSize, isize })
      totalLength += isize
      pos += blockSize
    }

    if (blockInfo.length === 0 && inputData.length > 0) {
      throw new Error(
        `No valid BGZF blocks found in ${inputData.length} bytes of data`,
      )
    }

    const result = new Uint8Array(totalLength)
    let offset = 0

    for (const { pos, blockSize, isize } of blockInfo) {
      try {
        const block = inputData.subarray(pos, pos + blockSize)
        const headerSize = parseGzipHeader(block)
        const deflateData = block.subarray(headerSize, blockSize - 8)

        const inflator = new Inflate({ raw: true })
        inflator.push(deflateData, Z_SYNC_FLUSH)
        if (inflator.err) {
          throw new Error(inflator.msg)
        }

        const decompressed = inflator.result as Uint8Array
        if (decompressed.length !== isize) {
          throw new Error(
            `Decompressed size ${decompressed.length} does not match ISIZE ${isize}`,
          )
        }
        result.set(decompressed, offset)
        offset += decompressed.length
      } catch (e) {
        throw new Error(
          `Failed at block position ${pos}, blockSize ${blockSize}, isize ${isize}: ${e}`,
        )
      }
    }

    return result
  } catch (e) {
    throw new Error(`problem decompressing block: ${e}`, { cause: e })
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
    while (cpos < inputData.length + minv.blockPosition) {
      const remainingInput = inputData.subarray(cpos - minv.blockPosition)
      const blockSize = (remainingInput[16]! | (remainingInput[17]! << 8)) + 1
      const cacheKey = cpos.toString()

      let buffer: Uint8Array

      const cached = blockCache?.get(cacheKey)
      if (cached) {
        buffer = cached.buffer
      } else {
        const headerSize = parseGzipHeader(remainingInput)
        const deflateData = remainingInput.subarray(headerSize, blockSize - 8)

        const inflator = new Inflate({ raw: true })
        inflator.push(deflateData, Z_SYNC_FLUSH)
        if (inflator.err) {
          throw new Error(inflator.msg)
        }

        buffer = inflator.result as Uint8Array
        blockCache?.set(cacheKey, { buffer, nextIn: blockSize })
      }

      chunks.push(buffer)
      let len = buffer.length

      cpositions.push(cpos)
      dpositions.push(dpos)
      if (chunks.length === 1 && minv.dataPosition) {
        chunks[0] = chunks[0]!.subarray(minv.dataPosition)
        len = chunks[0].length
      }
      const origCpos = cpos
      cpos += blockSize
      dpos += len

      if (origCpos >= maxv.blockPosition) {
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
    }

    return {
      buffer: concatUint8Array(chunks, totalLength),
      cpositions,
      dpositions,
    }
  } catch (e) {
    throw new Error(`problem decompressing block`, { cause: e })
  }
}
