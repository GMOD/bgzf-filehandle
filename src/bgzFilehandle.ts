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
    let next = nextCompressedPosition
    if (!next) {
      next = (await this.filehandle.stat()).size
    }

    // read the compressed data into the block buffer
    const blockCompressedLength = next - compressedPosition

    const blockBuffer = await this.filehandle.read(
      blockCompressedLength,
      compressedPosition,
    )

    // uncompress it
    return unzip(blockBuffer)
  }

  async read(length: number, position: number) {
    const blockPositions = await this.gzi.getRelevantBlocksForRead(
      length,
      position,
    )
    const blocks = [] as Uint8Array[]
    for (
      let blockNum = 0;
      blockNum < blockPositions.length - 1;
      blockNum += 1
    ) {
      const uncompressedBuffer = await this._readAndUncompressBlock(
        blockPositions[blockNum]![0],
        blockPositions[blockNum + 1]![0],
      )
      const [, uncompressedPosition] = blockPositions[blockNum]!
      const sourceOffset =
        uncompressedPosition >= position ? 0 : position - uncompressedPosition
      const sourceEnd =
        Math.min(
          position + length,
          uncompressedPosition + uncompressedBuffer.length,
        ) - uncompressedPosition
      if (sourceOffset >= 0 && sourceOffset < uncompressedBuffer.length) {
        blocks.push(uncompressedBuffer.subarray(sourceOffset, sourceEnd))
      }
    }

    return concatUint8Array(blocks)
  }
}
