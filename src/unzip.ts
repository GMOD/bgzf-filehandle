import { gunzipSync } from 'fflate'

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

function parseBgzfBlockSize(data: Uint8Array) {
  if (data[0] !== 0x1f || data[1] !== 0x8b) {
    throw new Error('Not a gzip file')
  }

  const flags = data[3]!
  let pos = 10

  if (flags & 0x04) {
    const xlen = data[pos]! | (data[pos + 1]! << 8)
    pos += 2
    const extraEnd = pos + xlen
    while (pos < extraEnd) {
      const si1 = data[pos]
      const si2 = data[pos + 1]
      const slen = data[pos + 2]! | (data[pos + 3]! << 8)
      if (si1 === 66 && si2 === 67 && slen === 2) {
        const bsize = data[pos + 4]! | (data[pos + 5]! << 8)
        return bsize + 1
      }
      pos += 4 + slen
    }
  }
  throw new Error('Not a BGZF block: missing BSIZE in extra field')
}

// browserify-zlib, which is the zlib shim used by default in webpacked code,
// does not properly uncompress bgzf chunks that contain more than one bgzf
// block, so export an unzip function that uses fflate directly if we are running
// in a browser.
export async function unzip(inputData: Uint8Array) {
  try {
    let pos = 0
    const blocks = [] as Uint8Array[]
    let totalLength = 0

    while (pos < inputData.length) {
      const remainingInput = inputData.subarray(pos)
      if (remainingInput.length < 18) {
        break
      }
      const blockSize = parseBgzfBlockSize(remainingInput)
      if (blockSize > remainingInput.length) {
        break
      }
      const block = remainingInput.subarray(0, blockSize)
      const result = gunzipSync(block)
      blocks.push(result)
      totalLength += result.length
      pos += blockSize
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
    const chunks = [] as Uint8Array[]
    const cpositions = [] as number[]
    const dpositions = [] as number[]

    let i = 0
    let totalLength = 0

    while (cpos < inputData.length + minv.blockPosition) {
      const remainingInput = inputData.subarray(cpos - minv.blockPosition)
      const cacheKey = cpos.toString()

      let buffer: Uint8Array
      let nextIn: number

      const cached = blockCache?.get(cacheKey)
      if (cached) {
        buffer = cached.buffer
        nextIn = cached.nextIn
      } else {
        nextIn = parseBgzfBlockSize(remainingInput)
        const block = remainingInput.subarray(0, nextIn)
        buffer = gunzipSync(block)
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
