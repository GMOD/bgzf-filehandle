import { LocalFile, GenericFilehandle } from 'generic-filehandle2'

// locals
import { unzip } from './unzip'
import GziIndex from './gziIndex'
import { concatUint8Array } from './util'

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

  async stat() {
    const compressedStat = await this.filehandle.stat()
    return Object.assign(compressedStat, {
      size: await this.getUncompressedFileSize(),
      blocks: undefined,
      blksize: undefined,
    })
  }

  async getUncompressedFileSize() {
    // read the last block's ISIZE (see gzip RFC),
    // and add it to its uncompressedPosition
    const [, uncompressedPosition] = await this.gzi.getLastBlock()

    const { size } = await this.filehandle.stat()

    // note: there should be a 28-byte EOF marker (an empty block) at
    // the end of the file, so we skip backward past that
    const buf = await this.filehandle.read(4, size - 28 - 4)
    const dataView = new DataView(buf.buffer)
    const lastBlockUncompressedSize = dataView.getUint32(0, true)
    return uncompressedPosition + lastBlockUncompressedSize
  }

  async _readAndUncompressBlock(
    [compressedPosition]: [number],
    [nextCompressedPosition]: [number],
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
        blockPositions[blockNum],
        blockPositions[blockNum + 1],
      )
      const [, uncompressedPosition] = blockPositions[blockNum]
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
