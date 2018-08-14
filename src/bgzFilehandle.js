const zlib = require('zlib')
const unzip = require('util.promisify')(zlib.unzip)
// const { Parser } = require('binary-parser')

const LocalFile = require('./localFile')
const GziIndex = require('./gziIndex')

// const subfieldParser = new Parser().array(null, {
//   readUntil: 'eof',
//   type: new Parser()
//     .endianess('little')
//     .uint16('identifier')
//     .uint16('length')
//     .buffer('data', { length: 'length' }),
// })

// const headerParser = new Parser()
//   .endianess('little')
//   .uint16('magic', { assert: magic => magic === 35615 })
//   .uint8('compressionMethod')
//   .uint8('flags', { assert: flags => flags & 0x4 }) // flags.FEXTRA must be set
//   .uint32('mtime')
//   .uint8('extraFlags')
//   .uint8('operatingSystem')
//   .uint16('extraLength')
//   // .buffer('subfieldData', { length: 'extraLength' })
//   .array('subfields', {
//     lengthInBytes: 'extraLength',
//     type: new Parser()
//       .endianess('little')
//       .uint16('identifier')
//       .uint16('length')
//       .buffer('data', { length: 'length' }),
//   })

class BgzFilehandle {
  constructor({ filehandle, path, gziFilehandle, gziPath }) {
    if (filehandle) this.filehandle = filehandle
    else if (path) this.filehandle = new LocalFile(path)
    else throw new TypeError('either filehandle or path must be defined')

    if (!gziFilehandle && !gziPath && !path)
      throw new TypeError('either gziFilehandle or gziPath must be defined')
    if (!gziFilehandle && !gziPath && path) gziPath = `${path}.gzi`

    this.gzi = new GziIndex({ filehandle: gziFilehandle, path: gziPath })
  }

  async stat() {
    const compressedStat = await this.filehandle.stat()
    return {
      size: await this.getUncompressedFileSize(),
      mtime: compressedStat.mtime,
    }
  }

  async getUncompressedFileSize() {
    // read the last block's ISIZE (see gzip RFC),
    // and add it to its uncompressedPosition
    const [, uncompressedPosition] = await this.gzi.getLastBlock()

    const { size } = await this.filehandle.stat()

    const buf = Buffer.allocUnsafe(4)
    // note: there should be a 28-byte EOF marker (an empty block) at
    // the end of the file, so we skip backward past that
    const { bytesRead } = await this.filehandle.read(buf, 0, 4, size - 28 - 4)
    if (bytesRead !== 4) throw new Error('read error')
    const lastBlockUncompressedSize = buf.readUInt32LE(0)
    return uncompressedPosition + lastBlockUncompressedSize
  }

  // async readBlockHeader(compressedPosition) {
  //   const buf = Buffer.allocUnsafe(8192)

  //   await this.filehandle.read(
  //     buf,
  //     0,
  //     8192, // block header should fit in much less than 16KB, one would hope
  //     // compressedStat.size - lastBlock.compressedPosition - 1,
  //     compressedPosition,
  //   )

  //   const headerData = headerParser.parse(buf)
  //   return headerData
  // }

  async _readAndUncompressBlock(
    blockBuffer,
    [compressedPosition],
    [nextCompressedPosition],
  ) {
    if (!nextCompressedPosition) {
      nextCompressedPosition = (await this.filehandle.stat()).size
    }

    // read the compressed data into the block buffer
    const blockCompressedLength = nextCompressedPosition - compressedPosition

    await this.filehandle.read(
      blockBuffer,
      0,
      blockCompressedLength,
      compressedPosition,
    )

    // uncompress it
    const unzippedBuffer = await unzip(
      blockBuffer.slice(0, blockCompressedLength),
    )

    return unzippedBuffer
  }

  async read(buf, offset, length, position) {
    // get the block positions for this read
    const blockPositions = await this.gzi.getRelevantBlocksForRead(
      position,
      length,
    )
    const blockBuffer = Buffer.allocUnsafe(32768 * 2)
    // uncompress the blocks and read from them one at a time to keep memory usage down
    let destinationOffset = offset
    let bytesRead = 0
    for (
      let blockNum = 0;
      blockNum < blockPositions.length - 1;
      blockNum += 1
    ) {
      const uncompressedBuffer = await this._readAndUncompressBlock(
        blockBuffer,
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
        uncompressedBuffer.copy(buf, destinationOffset, sourceOffset, sourceEnd)
        destinationOffset += sourceEnd - sourceOffset
        bytesRead += sourceEnd - sourceOffset
      }
    }

    return { bytesRead, buffer: buf }
  }
}

module.exports = BgzFilehandle
