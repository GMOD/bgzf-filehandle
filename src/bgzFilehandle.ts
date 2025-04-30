import type { GenericFilehandle } from 'generic-filehandle2'
import { LocalFile } from 'generic-filehandle2'

import { unzip } from './unzip.ts'
import GziIndex from './gziIndex.ts'
import { concatUint8Array } from './util.ts'

export default class BgzFilehandle {
  filehandle: GenericFilehandle
  gzi: GziIndex

  constructor({
    filehandle,
    path,
    gziFilehandle,
    gziPath,
  }: {
    filehandle?: GenericFilehandle
    path?: string
    gziFilehandle?: GenericFilehandle
    gziPath?: string
  }) {
    if (filehandle) {
      this.filehandle = filehandle
    } else if (path) {
      this.filehandle = new LocalFile(path)
    } else {
      throw new TypeError('either filehandle or path must be defined')
    }

    if (!gziFilehandle && !gziPath && !path) {
      throw new TypeError('either gziFilehandle or gziPath must be defined')
    }

    this.gzi = new GziIndex({
      filehandle: gziFilehandle,
      path: !gziFilehandle && !gziPath && path ? gziPath : `${path}.gzi`,
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
