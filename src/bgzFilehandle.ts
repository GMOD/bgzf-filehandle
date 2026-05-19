import GziIndex from './gziIndex.ts'
import { unzip } from './unzip.ts'
import { concatUint8Array } from './util.ts'

import type { GenericFilehandle } from 'generic-filehandle2'

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

  constructor({
    filehandle,
    gziFilehandle,
  }: {
    filehandle: GenericFilehandle
    gziFilehandle: GenericFilehandle
  }) {
    this.filehandle = filehandle

    this.gzi = new GziIndex({
      filehandle: gziFilehandle,
    })
  }

  async _readAndUncompressBlock(
    compressedPosition: number,
    nextCompressedPosition: number,
  ) {
    const blockBuffer = await this.filehandle.read(
      nextCompressedPosition - compressedPosition,
      compressedPosition,
    )
    return unzip(blockBuffer)
  }

  async _getFileSize() {
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

    const decompressed: Uint8Array[] = []
    for (let i = 0; i < blocks.length; i += 1) {
      const [compressedPos, uncompressedPos] = blocks[i]!
      const nextCompressed = blocks[i + 1]?.[0] ?? lastBlockEnd
      const buffer = await this._readAndUncompressBlock(
        compressedPos,
        nextCompressed,
      )
      decompressed.push(sliceBlock(buffer, uncompressedPos, position, readEnd))
    }

    return concatUint8Array(decompressed)
  }
}
