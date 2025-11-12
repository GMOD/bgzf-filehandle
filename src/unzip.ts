// Note: this was refactored in 2025 to use DecompressionStream based on example from
// https://github.com/nrminor/genotype/ (permalink
// https://github.com/nrminor/genotype/blob/a11218f7c28e39238dde058935bc43666f4ae39a/src/formats/bam/bgzf.ts)
// This repo has the following license
// MIT License
//
// Copyright (c) 2025 Nicholas R. Minor
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
import { Inflate, Z_SYNC_FLUSH } from 'pako-esm2'

import { concatUint8Array } from './util.ts'

// Type for the block cache
export interface BlockCache {
  get(key: string): { buffer: Uint8Array; nextIn: number } | undefined
  set(key: string, value: { buffer: Uint8Array; nextIn: number }): void
}

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

// Helper function to decompress a single gzip block using native DecompressionStream
async function inflateSingleBlock(
  compressedData: Uint8Array,
): Promise<Uint8Array> {
  const decompressor = new DecompressionStream('gzip')
  const writer = decompressor.writable.getWriter()
  const reader = decompressor.readable.getReader()

  // Write compressed data (cast to BufferSource for DOM compatibility)
  const writePromise = writer
    .write(compressedData as BufferSource)
    .then(() => writer.close())

  // Read decompressed result
  const chunks: Uint8Array[] = []
  let totalLength = 0

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    chunks.push(value)
    totalLength += value.length
  }

  // Ensure write is complete
  await writePromise

  // Combine chunks
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

// Parse BGZF block size from gzip header
// BGZF stores the total block size - 1 in the BSIZE extra field
function getBgzfBlockSize(data: Uint8Array, offset: number): number | null {
  // Check for gzip magic number
  if (data[offset] !== 0x1f || data[offset + 1] !== 0x8b) {
    return null
  }

  // Check compression method (should be 8 = deflate)
  if (data[offset + 2] !== 8) {
    return null
  }

  const flags = data[offset + 3]
  // FLG.FEXTRA bit should be set (0x04)
  if (!(flags! & 0x04)) {
    return null
  }

  // Skip to extra field length (at offset 10)
  const xlen = data[offset + 10]! | (data[offset + 11]! << 8)

  // Parse extra subfields to find BSIZE
  let extraOffset = offset + 12
  const extraEnd = extraOffset + xlen

  while (extraOffset + 4 <= extraEnd) {
    const si1 = data[extraOffset]
    const si2 = data[extraOffset + 1]
    const slen = data[extraOffset + 2]! | (data[extraOffset + 3]! << 8)

    if (si1 === 0x42 && si2 === 0x43 && slen === 2) {
      // Found BC subfield (BGZF)
      const bsize = data[extraOffset + 4]! | (data[extraOffset + 5]! << 8)
      return bsize + 1 // BSIZE is block size - 1
    }

    extraOffset += 4 + slen
  }

  return null
}

// Helper function to decompress BGZF data using native DecompressionStream
// BGZF uses multiple concatenated gzip blocks
async function inflateWithDecompressionStream(
  inputData: Uint8Array,
): Promise<Uint8Array> {
  const blocks: Uint8Array[] = []
  let pos = 0

  // Process each BGZF block individually
  while (pos < inputData.length) {
    const blockSize = getBgzfBlockSize(inputData, pos)
    if (!blockSize || pos + blockSize > inputData.length) {
      // Can't parse block size, fall back to pako
      throw new Error('Unable to parse BGZF block size')
    }

    const blockData = inputData.subarray(pos, pos + blockSize)
    const decompressed = await inflateSingleBlock(blockData)
    blocks.push(decompressed)

    pos += blockSize
  }

  return concatUint8Array(blocks)
}

// Decompress using pako (fallback)
function inflateWithPako(inputData: Uint8Array) {
  let strm
  let pos = 0
  let inflator
  const blocks = [] as Uint8Array[]
  do {
    const remainingInput = inputData.subarray(pos)
    inflator = new Inflate(undefined)
    ;({ strm } = inflator)
    inflator.push(remainingInput, Z_SYNC_FLUSH)
    if (inflator.err) {
      throw new Error(inflator.msg)
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    pos += strm!.next_in
    blocks.push(inflator.result as Uint8Array)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  } while (strm!.avail_in)

  return concatUint8Array(blocks)
}

// browserify-zlib, which is the zlib shim used by default in webpacked code,
// does not properly uncompress bgzf chunks that contain more than one bgzf
// block, so export an unzip function that uses native DecompressionStream if available,
// falling back to @progress/pako-esm2.
export async function unzip(inputData: Uint8Array) {
  try {
    // Use native DecompressionStream if available (modern browsers/runtimes)
    if (typeof DecompressionStream !== 'undefined') {
      // Try to decompress using native API
      // Note: We process each BGZF block individually
      try {
        const result = await inflateWithDecompressionStream(inputData)
        return result
      } catch (e) {
        // If that fails, fall back to pako which handles multiple blocks better
        console.warn(`Encountered error ${e}: attempting pako`)
        return inflateWithPako(inputData)
      }
    }

    // Fallback to pako
    return inflateWithPako(inputData)
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

// Helper function for decompressing a single block with position tracking using pako
function inflateBlockWithPako(remainingInput: Uint8Array) {
  const inflator = new Inflate(undefined)
  const { strm } = inflator
  inflator.push(remainingInput, Z_SYNC_FLUSH)
  if (inflator.err) {
    throw new Error(inflator.msg)
  }

  return {
    buffer: inflator.result as Uint8Array,

    nextIn: strm!.next_in,
  }
}

// Helper function for decompressing a single block with position tracking
// Uses DecompressionStream when available, falls back to pako
async function inflateBlock(
  remainingInput: Uint8Array,
  useNative: boolean,
): Promise<{ buffer: Uint8Array; nextIn: number }> {
  // Parse block size from BGZF header
  const blockSize = getBgzfBlockSize(remainingInput, 0)
  if (!blockSize || blockSize > remainingInput.length) {
    throw new Error('Unable to parse BGZF block size')
  }

  const blockData = remainingInput.subarray(0, blockSize)

  if (useNative) {
    // Use native DecompressionStream
    const buffer = await inflateSingleBlock(blockData)
    return { buffer, nextIn: blockSize }
  } else {
    // Use pako
    return inflateBlockWithPako(remainingInput)
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

    // Try to use native DecompressionStream, fall back to pako if it fails
    const useNative = typeof DecompressionStream !== 'undefined'
    let i = 0

    while (cpos < inputData.length + minv.blockPosition) {
      const remainingInput = inputData.subarray(cpos - minv.blockPosition)
      if (remainingInput.length === 0) {
        break
      }

      const cacheKey = generateCacheKey(cpos, remainingInput)

      let buffer: Uint8Array
      let nextIn: number

      // Check cache first
      const cached = blockCache?.get(cacheKey)
      if (cached) {
        buffer = cached.buffer
        nextIn = cached.nextIn
      } else {
        // Not in cache, decompress and store
        try {
          const result = await inflateBlock(remainingInput, useNative)
          buffer = result.buffer
          nextIn = result.nextIn
        } catch (e) {
          // If native fails, try pako
          if (useNative) {
            const result = inflateBlockWithPako(remainingInput)
            buffer = result.buffer
            nextIn = result.nextIn
          } else {
            throw e
          }
        }

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
    }

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
