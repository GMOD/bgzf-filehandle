import { inflateSync } from 'fflate'

import { concatUint8Array } from './util.ts'

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

interface BgzfBlockInfo {
  blockSize: number
  deflateStart: number
  deflateEnd: number
}

function parseBgzfBlock(data: Uint8Array): BgzfBlockInfo {
  if (data[0] !== 0x1f || data[1] !== 0x8b) {
    throw new Error('Not a gzip file')
  }

  const flags = data[3]!
  let pos = 10
  let blockSize = 0

  if (flags & 0x04) {
    const xlen = data[pos]! | (data[pos + 1]! << 8)
    pos += 2
    const extraEnd = pos + xlen
    while (pos < extraEnd) {
      const si1 = data[pos]
      const si2 = data[pos + 1]
      const slen = data[pos + 2]! | (data[pos + 3]! << 8)
      if (si1 === 66 && si2 === 67 && slen === 2) {
        blockSize = (data[pos + 4]! | (data[pos + 5]! << 8)) + 1
      }
      pos += 4 + slen
    }
  }

  if (blockSize === 0) {
    throw new Error('Not a BGZF block: missing BSIZE in extra field')
  }

  // deflate data ends 8 bytes before block end (4 byte CRC32 + 4 byte ISIZE)
  return {
    blockSize,
    deflateStart: pos,
    deflateEnd: blockSize - 8,
  }
}

// browserify-zlib, which is the zlib shim used by default in webpacked code,
// does not properly uncompress bgzf chunks that contain more than one bgzf
// block, so export an unzip function that uses fflate directly if we are running
// in a browser.
export async function unzip(inputData: Uint8Array) {
  try {
    let pos = 0
    const blocks: Uint8Array[] = []
    let totalLength = 0
    let firstBlockError: Error | undefined

    while (pos < inputData.length) {
      const remainingInput = inputData.subarray(pos)
      if (remainingInput.length < 18) {
        break
      }

      let info: BgzfBlockInfo
      try {
        info = parseBgzfBlock(remainingInput)
      } catch (e) {
        if (blocks.length === 0) {
          firstBlockError = e as Error
        }
        break
      }

      if (info.blockSize > remainingInput.length) {
        break
      }

      const deflateData = remainingInput.subarray(
        info.deflateStart,
        info.deflateEnd,
      )
      const result = inflateSync(deflateData)
      blocks.push(result)
      totalLength += result.length
      pos += info.blockSize
    }

    if (blocks.length === 0 && firstBlockError) {
      throw firstBlockError
    }

    return concatUint8Array(blocks, totalLength)
  } catch (e) {
    if (/Not a gzip file/.exec(`${e}`)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw e
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
    const chunks: Uint8Array[] = []
    const cpositions: number[] = []
    const dpositions: number[] = []
    let firstBlockError: Error | undefined

    let i = 0
    let totalLength = 0

    while (cpos < inputData.length + minv.blockPosition) {
      const remainingInput = inputData.subarray(cpos - minv.blockPosition)
      if (remainingInput.length < 18) {
        break
      }
      const cacheKey = cpos.toString()

      let buffer: Uint8Array
      let nextIn: number

      const cached = blockCache?.get(cacheKey)
      if (cached) {
        buffer = cached.buffer
        nextIn = cached.nextIn
      } else {
        let info: BgzfBlockInfo
        try {
          info = parseBgzfBlock(remainingInput)
        } catch (e) {
          if (chunks.length === 0) {
            firstBlockError = e as Error
          }
          break
        }
        if (info.blockSize > remainingInput.length) {
          break
        }
        nextIn = info.blockSize
        const deflateData = remainingInput.subarray(
          info.deflateStart,
          info.deflateEnd,
        )
        buffer = inflateSync(deflateData)
        blockCache?.set(cacheKey, { buffer, nextIn })
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
      cpos += nextIn
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

    if (chunks.length === 0 && firstBlockError) {
      throw firstBlockError
    }

    return {
      buffer: concatUint8Array(chunks, totalLength),
      cpositions,
      dpositions,
    }
  } catch (e) {
    if (/Not a gzip file/.exec(`${e}`)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw e
  }
}
