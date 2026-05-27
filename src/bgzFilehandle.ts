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

function sliceBlock(
  uncompressedBuffer: Uint8Array,
  blockStart: number,
  readStart: number,
  readEnd: number,
) {
  const sourceOffset = Math.max(0, readStart - blockStart)
  const sourceEnd =
    Math.min(readEnd, blockStart + uncompressedBuffer.length) - blockStart
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

  private async _readAndUncompressBlock(
    compressedPosition: number,
    length: number,
  ) {
    const blockBuffer = await this.filehandle.read(length, compressedPosition)
    return unzip(blockBuffer)
  }

  async read(length: number, position: number) {
    const { blocks, nextCompressedPosition } =
      await this.gzi.getRelevantBlocksForRead(length, position)
    if (blocks.length === 0) {
      return new Uint8Array(0)
    }
    const readEnd = position + length

    const decompressed = await Promise.all(
      blocks.map(([compressedPos, uncompressedPos], i) =>
        this.limit(async () => {
          // For the trailing block whose end isn't pinned by the next gzi entry
          // or the next-read-position hint, over-read by the max BGZF block
          // size. `compressedPos` is always a valid gzi offset (start within
          // file); the server clips the request to actual file size, and
          // unzip handles whatever bytes come back.
          const nextCompressed =
            blocks[i + 1]?.[0] ??
            nextCompressedPosition ??
            compressedPos + MAX_BGZF_BLOCK_SIZE
          const buffer = await this._readAndUncompressBlock(
            compressedPos,
            nextCompressed - compressedPos,
          )
          return sliceBlock(buffer, uncompressedPos, position, readEnd)
        }),
      ),
    )

    return concatUint8Array(decompressed)
  }
}
