import GziIndex from './gziIndex.ts'
import { unzip } from './unzip.ts'
import { concatUint8Array } from './util.ts'

import type { GenericFilehandle } from 'generic-filehandle2'

// BGZF header is 18 bytes: 10 byte gzip header + 6 byte extra field + 2 byte BSIZE
const BGZF_HEADER_SIZE = 18

function getBgzfBlockSize(header: Uint8Array) {
  // BSIZE is at bytes 16-17 (little-endian), represents total block size - 1
  const bsize = header[16]! | (header[17]! << 8)
  return bsize + 1
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
    let blockCompressedLength: number
    if (nextCompressedPosition) {
      blockCompressedLength = nextCompressedPosition - compressedPosition
    } else {
      // Read the BGZF header to get the block size (avoids needing stat/file size)
      const header = await this.filehandle.read(
        BGZF_HEADER_SIZE,
        compressedPosition,
      )
      blockCompressedLength = getBgzfBlockSize(header)
    }

    const blockBuffer = await this.filehandle.read(
      blockCompressedLength,
      compressedPosition,
    )

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
