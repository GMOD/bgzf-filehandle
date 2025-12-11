import { concatUint8Array } from './util.ts'
import { decompressAll, decompressBlock } from './wasm/bgzf-wasm-inlined.js'


// Type for the block cache
export interface BlockCache {
  get(key: string): { buffer: Uint8Array; bytesRead: number } | undefined
  set(key: string, value: { buffer: Uint8Array; bytesRead: number }): void
}

interface VirtualOffset {
  blockPosition: number
  dataPosition: number
}
interface Chunk {
  minv: VirtualOffset
  maxv: VirtualOffset
}

// browserify-zlib and pako do not properly uncompress bgzf chunks that contain
// more than one bgzip block. bgzip is a type of 'multi-member' gzip file type.
// we make a custom unzip function to handle the bgzip blocks
export async function unzip(inputData: Uint8Array) {
  try {
    return await decompressAll(inputData)
  } catch (e) {
    // return a slightly more informative error message
    if (/incorrect header check/.exec(`${e}`)) {
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
    let hasMore = true

    while (hasMore && cpos < inputData.length + minv.blockPosition) {
      const remainingInput = inputData.subarray(cpos - minv.blockPosition)
      const cacheKey = cpos.toString()

      let buffer: Uint8Array
      let bytesRead: number

      // Check cache first
      const cached = blockCache?.get(cacheKey)
      if (cached) {
        buffer = cached.buffer
        bytesRead = cached.bytesRead
        hasMore = cpos + bytesRead < inputData.length + minv.blockPosition
      } else {
        // Not in cache, decompress using WASM
        const result = await decompressBlock(remainingInput)
        buffer = result.data
        bytesRead = result.bytesRead
        hasMore = bytesRead > 0 && cpos + bytesRead < inputData.length + minv.blockPosition

        // Cache the decompressed block
        blockCache?.set(cacheKey, { buffer, bytesRead })
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
      cpos += bytesRead
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
    }

    return {
      buffer: concatUint8Array(chunks, totalLength),
      cpositions,
      dpositions,
    }
  } catch (e) {
    // return a slightly more informative error message
    if (/incorrect header check/.exec(`${e}`)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw e
  }
}
