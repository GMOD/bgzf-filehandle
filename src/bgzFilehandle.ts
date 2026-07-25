import GziIndex from './gziIndex.ts'
import { unzip } from './unzip.ts'
import { concatUint8Array } from './util.ts'

import type { GenericFilehandle } from 'generic-filehandle2'

const DEFAULT_BLOCK_CONCURRENCY = 10

// BGZF blocks are bounded by a 16-bit BSIZE field in the gzip extra subfield —
// the compressed size of a single block can never exceed 65 536 bytes. Used as
// an upper bound for over-reading the trailing block whose end offset isn't
// recorded in the gzi index, so we can drop the stat() dependency.
const MAX_BGZF_BLOCK_SIZE = 1 << 16

// Blocks are adjacent in the file, so every block a read touches can be
// fetched as one contiguous byte range and handed to a single decompress call.
// Batches are capped by uncompressed size so an enormous read still streams
// through in pieces rather than materializing at once in the wasm heap, which
// only ever grows.
const MAX_BATCH_UNCOMPRESSED_SIZE = 32 * 1024 * 1024

// Small fixed-concurrency limiter to replace p-limit (which is pure ESM in
// v7+ and breaks downstream Jest/CJS consumers). Tasks beyond the limit
// queue until a slot frees.
function createLimit(concurrency: number) {
  let active = 0
  const queue: (() => void)[] = []
  const next = () => {
    active--
    queue.shift()?.()
  }
  return async <T>(task: () => Promise<T> | T): Promise<T> => {
    if (active >= concurrency) {
      await new Promise<void>(resolve => {
        queue.push(resolve)
      })
    }
    active++
    try {
      return await task()
    } finally {
      next()
    }
  }
}

interface Batch {
  compressedStart: number
  compressedEnd: number
  uncompressedStart: number
}

function makeBatches(
  compressed: Float64Array,
  uncompressed: Float64Array,
  nextCompressedPosition: number | undefined,
) {
  const batches: Batch[] = []
  const numBlocks = compressed.length
  let start = 0
  while (start < numBlocks) {
    let end = start + 1
    while (
      end < numBlocks &&
      uncompressed[end]! - uncompressed[start]! < MAX_BATCH_UNCOMPRESSED_SIZE
    ) {
      end += 1
    }
    // `end` is the first block past this batch, so its compressed offset is
    // where the batch stops. Past the last relevant block that offset comes
    // from the next gzi entry — and when there is none, from over-reading by
    // one maximum-size block, which keeps this off of stat().
    batches.push({
      compressedStart: compressed[start]!,
      compressedEnd:
        end < numBlocks
          ? compressed[end]!
          : (nextCompressedPosition ??
            compressed[numBlocks - 1]! + MAX_BGZF_BLOCK_SIZE),
      uncompressedStart: uncompressed[start]!,
    })
    start = end
  }
  return batches
}

function sliceBatch(
  uncompressedBuffer: Uint8Array,
  batchStart: number,
  readStart: number,
  readEnd: number,
) {
  const sourceOffset = Math.max(0, readStart - batchStart)
  const sourceEnd =
    Math.min(readEnd, batchStart + uncompressedBuffer.length) - batchStart
  return sourceOffset < uncompressedBuffer.length
    ? uncompressedBuffer.subarray(sourceOffset, sourceEnd)
    : new Uint8Array(0)
}

export default class BgzFilehandle {
  filehandle: GenericFilehandle
  gzi: GziIndex
  limit: ReturnType<typeof createLimit>

  constructor({
    filehandle,
    gziFilehandle,
    blockConcurrency = DEFAULT_BLOCK_CONCURRENCY,
  }: {
    filehandle: GenericFilehandle
    gziFilehandle: GenericFilehandle
    blockConcurrency?: number
  }) {
    this.filehandle = filehandle
    this.gzi = new GziIndex({
      filehandle: gziFilehandle,
    })
    this.limit = createLimit(blockConcurrency)
  }

  async read(length: number, position: number) {
    const { compressed, uncompressed, nextCompressedPosition } =
      await this.gzi.getRelevantBlocksForRead(length, position)
    if (compressed.length === 0) {
      return new Uint8Array(0)
    }
    const readEnd = position + length
    const batches = makeBatches(
      compressed,
      uncompressed,
      nextCompressedPosition,
    )

    const decompressed = await Promise.all(
      batches.map(batch =>
        this.limit(async () => {
          const buffer = await this.filehandle.read(
            batch.compressedEnd - batch.compressedStart,
            batch.compressedStart,
          )
          return sliceBatch(
            await unzip(buffer),
            batch.uncompressedStart,
            position,
            readEnd,
          )
        }),
      ),
    )

    // Always copy, even for a single batch: the pieces are subarray views of a
    // whole decompressed batch, so returning one directly would hand back a
    // buffer whose `.buffer` is larger than the requested read.
    return concatUint8Array(decompressed)
  }
}
