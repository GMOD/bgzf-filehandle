import pkg from 'pako'

import { concatUint8Array } from './util.ts'

//@ts-ignore
const { Z_SYNC_FLUSH, Inflate } = pkg

// Type for the block cache
export type BlockCache = Map<string, { buffer: Uint8Array; nextIn: number }>

// Generate cache key from block position and data hash
function generateCacheKey(
  blockPosition: number,
  inputData: Uint8Array,
): string {
  // Simple hash of first 32 bytes for cache key uniqueness
  const hashData = inputData.subarray(0, Math.min(32, inputData.length))
  let hash = 0
  const len = hashData.length
  for (let i = 0; i < len; i++) {
    hash = ((hash << 5) - hash + hashData[i]!) & 0xffffffff
  }
  return `${blockPosition}_${hash}`
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
// block, so export an unzip function that uses pako directly if we are running
// in a browser.
export async function unzip(inputData: Uint8Array) {
  try {
    let strm
    let pos = 0
    let inflator
    const blocks = [] as Uint8Array[]
    do {
      const remainingInput = inputData.subarray(pos)
      inflator = new Inflate()
      //@ts-ignore
      ;({ strm } = inflator)
      inflator.push(remainingInput, Z_SYNC_FLUSH)
      if (inflator.err) {
        throw new Error(inflator.msg)
      }

      pos += strm.next_in
      blocks.push(inflator.result as Uint8Array)
    } while (strm.avail_in)

    return concatUint8Array(blocks)
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
    let strm
    const { minv, maxv } = chunk
    let cpos = minv.blockPosition
    let dpos = minv.dataPosition
    const chunks = [] as Uint8Array[]
    const cpositions = [] as number[]
    const dpositions = [] as number[]

    let i = 0
    let wasFromCache = false
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let cacheHits = 0
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let cacheMisses = 0
    do {
      const remainingInput = inputData.subarray(cpos - minv.blockPosition)
      const cacheKey = generateCacheKey(cpos, remainingInput)

      let buffer: Uint8Array
      let nextIn: number

      // Check cache first
      const cached = blockCache?.get(cacheKey)
      if (cached) {
        buffer = cached.buffer
        nextIn = cached.nextIn
        wasFromCache = true
        cacheHits++
      } else {
        // Not in cache, decompress and store
        const inflator = new Inflate()
        // @ts-ignore
        ;({ strm } = inflator)
        inflator.push(remainingInput, Z_SYNC_FLUSH)
        if (inflator.err) {
          throw new Error(inflator.msg)
        }

        buffer = inflator.result as Uint8Array
        nextIn = strm.next_in
        wasFromCache = false
        cacheMisses++

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

        cpositions.push(cpos)
        dpositions.push(dpos)
        break
      }
      i++
    } while (
      wasFromCache
        ? cpos < inputData.length + minv.blockPosition
        : strm.avail_in
    )

    // const totalBlocks = cacheHits + cacheMisses
    // const hitRate =
    //   totalBlocks > 0 ? ((cacheHits / totalBlocks) * 100).toFixed(1) : '0.0'
    // const cacheStatus = blockCache ? `${hitRate}% hit rate` : 'no cache'
    // console.log(
    //   `unzipChunkSlice: ${cacheHits} hits, ${cacheMisses} misses (${cacheStatus}, ${totalBlocks} blocks)`,
    // )

    return {
      buffer: concatUint8Array(chunks),
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
