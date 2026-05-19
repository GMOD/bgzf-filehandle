import GziIndex from './gziIndex.ts'
import { unzip } from './unzip.ts'
import { concatUint8Array } from './util.ts'

import type { GenericFilehandle } from 'generic-filehandle2'

const DEFAULT_BLOCK_CONCURRENCY = 10

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
    nextCompressedPosition: number,
  ) {
    const blockBuffer = await this.filehandle.read(
      nextCompressedPosition - compressedPosition,
      compressedPosition,
    )
    return unzip(blockBuffer)
  }

  private async _getFileSize() {
    return (await this.filehandle.stat()).size
  }

  async read(length: number, position: number) {
    const { blocks, nextCompressedPosition } =
      await this.gzi.getRelevantBlocksForRead(length, position)
    if (blocks.length === 0) {
      return new Uint8Array(0)
    }
    const lastBlockEnd = nextCompressedPosition ?? (await this._getFileSize())
    const readEnd = position + length

    const decompressed = await Promise.all(
      blocks.map(([compressedPos, uncompressedPos], i) =>
        this.limit(async () => {
          const nextCompressed = blocks[i + 1]?.[0] ?? lastBlockEnd
          const buffer = await this._readAndUncompressBlock(
            compressedPos,
            nextCompressed,
          )
          return sliceBlock(buffer, uncompressedPos, position, readEnd)
        }),
      ),
    )

    return concatUint8Array(decompressed)
  }
}
