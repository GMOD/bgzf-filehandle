import GziIndex from './gziIndex.ts'
import { unzip } from './unzip.ts'
import { concatUint8Array } from './util.ts'

import type { GenericFilehandle } from 'generic-filehandle2'

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

  async read(length: number, position: number) {
    const { blocks: blockPositions, nextCompressedPosition } =
      await this.gzi.getRelevantBlocksForRead(length, position)
    const decompressed: Uint8Array[] = []
    for (let blockNum = 0; blockNum < blockPositions.length; blockNum += 1) {
      const [compressedPosition, uncompressedPosition] =
        blockPositions[blockNum]!
      const nextBlock = blockPositions[blockNum + 1]
      const nextCompressed = nextBlock
        ? nextBlock[0]
        : (nextCompressedPosition ?? (await this.filehandle.stat()).size)
      const uncompressedBuffer = await this._readAndUncompressBlock(
        compressedPosition,
        nextCompressed,
      )
      const sourceOffset = Math.max(0, position - uncompressedPosition)
      const sourceEnd =
        Math.min(
          position + length,
          uncompressedPosition + uncompressedBuffer.length,
        ) - uncompressedPosition
      if (sourceOffset < uncompressedBuffer.length) {
        decompressed.push(uncompressedBuffer.subarray(sourceOffset, sourceEnd))
      }
    }

    return concatUint8Array(decompressed)
  }
}
