import { Inflate, Z_SYNC_FLUSH } from 'pako-esm2'

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

    // First pass: calculate total size and collect block metadata
    const blockInfos: { cpos: number; blockSize: number; isize: number }[] = []
    let cpos = minv.blockPosition
    let totalLength = 0

    while (cpos < inputData.length + minv.blockPosition) {
      const remainingInput = inputData.subarray(cpos - minv.blockPosition)
      const blockSize = (remainingInput[16]! | (remainingInput[17]! << 8)) + 1
      const isize =
        remainingInput[blockSize - 4]! |
        (remainingInput[blockSize - 3]! << 8) |
        (remainingInput[blockSize - 2]! << 16) |
        (remainingInput[blockSize - 1]! << 24)

      const isFirstBlock = blockInfos.length === 0
      const isLastBlock = cpos >= maxv.blockPosition

      let effectiveSize = isize
      if (isFirstBlock && minv.dataPosition) {
        effectiveSize -= minv.dataPosition
      }
      if (isLastBlock) {
        effectiveSize =
          cpos === minv.blockPosition
            ? maxv.dataPosition - minv.dataPosition + 1
            : maxv.dataPosition + 1 - (isFirstBlock ? minv.dataPosition : 0)
      }

      blockInfos.push({ cpos, blockSize, isize })
      totalLength += effectiveSize

      if (isLastBlock) {
        break
      }
      cpos += blockSize
    }

    // Pre-allocate result buffer
    const result = new Uint8Array(totalLength)
    const cpositions: number[] = []
    const dpositions: number[] = []

    // Second pass: decompress and copy directly into result
    let dpos = minv.dataPosition
    let resultOffset = 0

    for (let i = 0; i < blockInfos.length; i++) {
      const { cpos, blockSize } = blockInfos[i]!
      const remainingInput = inputData.subarray(cpos - minv.blockPosition)
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

      cpositions.push(cpos)
      dpositions.push(dpos)

      const isFirstBlock = i === 0
      const isLastBlock = cpos >= maxv.blockPosition

      let startOffset = 0
      let endOffset = buffer.length

      if (isFirstBlock && minv.dataPosition) {
        startOffset = minv.dataPosition
      }
      if (isLastBlock) {
        endOffset =
          cpos === minv.blockPosition
            ? maxv.dataPosition + 1
            : maxv.dataPosition + 1
      }

      const slice = buffer.subarray(startOffset, endOffset)
      result.set(slice, resultOffset)
      resultOffset += slice.length
      dpos += endOffset - startOffset
    }

    // Add final position entries
    if (blockInfos.length > 0) {
      const lastInfo = blockInfos[blockInfos.length - 1]!
      cpositions.push(lastInfo.cpos + lastInfo.blockSize)
      dpositions.push(dpos)
    }

    return {
      buffer: result,
      cpositions,
      dpositions,
    }
  } catch (e) {
    throw new Error(`problem decompressing block`, { cause: e })
  }
}
