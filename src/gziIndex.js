const Long = require('long')
const LocalFile = require('./localFile')

// const COMPRESSED_POSITION = 0
const UNCOMPRESSED_POSITION = 1

class GziIndex {
  constructor({ filehandle, path }) {
    if (filehandle) this.filehandle = filehandle
    else if (path) this.filehandle = new LocalFile(path)
    else throw new TypeError('either filehandle or path must be defined')
  }

  _readLongWithOverflow(buf, offset = 0, unsigned = true) {
    const long = Long.fromBytesLE(buf.slice(offset, offset + 8), unsigned)
    if (
      long.greaterThan(Number.MAX_SAFE_INTEGER) ||
      long.lessThan(Number.MIN_SAFE_INTEGER)
    )
      throw new TypeError('integer overflow')

    return long.toNumber()
  }

  _getIndex() {
    if (!this.index) this.index = this._readIndex()
    return this.index
  }

  async _readIndex() {
    let buf = Buffer.allocUnsafe(8)
    await this.filehandle.read(buf, 0, 8, 0)
    const numEntries = this._readLongWithOverflow(buf, 0, true)
    if (!numEntries) return [[0, 0]]

    const entries = new Array(numEntries + 1)
    entries[0] = [0, 0]

    // TODO rewrite this to make an index-index that stays in memory
    const bufSize = 8 * 2 * numEntries
    if (bufSize > Number.MAX_SAFE_INTEGER)
      throw new TypeError('integer overflow')
    buf = Buffer.allocUnsafe(bufSize)
    await this.filehandle.read(buf, 0, bufSize, 8)
    for (let entryNumber = 0; entryNumber < numEntries; entryNumber += 1) {
      const compressedPosition = this._readLongWithOverflow(
        buf,
        entryNumber * 16,
      )
      const uncompressedPosition = this._readLongWithOverflow(
        buf,
        entryNumber * 16 + 8,
      )
      entries[entryNumber + 1] = [compressedPosition, uncompressedPosition]
    }

    return entries
  }

  /**
   * @returns {object} the entry for the last block in the index
   */
  async getLastBlock() {
    const entries = await this._getIndex()
    if (!entries.length) return undefined
    return entries[entries.length - 1]
  }

  /**
   * get an array of block records that must be read to execute
   * the given virtual read operation
   *
   * @param {number} position uncompressed read position
   * @param {number} length uncompressed read length
   * @returns {Promise} for an array of block records, the
   * last of which should *not* be included in the read
   */
  async getRelevantBlocksForRead(position, length) {
    const endPosition = position + length
    if (length === 0) return []
    const entries = await this._getIndex()
    const relevant = []

    // binary search to find the block that the
    // read starts in and extend forward from that
    const compare = (entry, nextEntry) => {
      const uncompressedPosition = entry[UNCOMPRESSED_POSITION]
      const nextUncompressedPosition = nextEntry
        ? nextEntry[UNCOMPRESSED_POSITION]
        : Infinity
      // block overlaps read start
      if (
        uncompressedPosition <= position &&
        nextUncompressedPosition > position
      ) {
        return 0
        // block is before read start
      } else if (uncompressedPosition < position) {
        return -1
      }
      // block is after read start
      return 1
    }

    let lowerBound = 0
    let upperBound = entries.length - 1
    let searchPosition = Math.floor(entries.length / 2)

    let comparison = compare(
      entries[searchPosition],
      entries[searchPosition + 1],
    )
    while (comparison !== 0) {
      if (comparison > 0) {
        upperBound = searchPosition - 1
      } else if (comparison < 0) {
        lowerBound = searchPosition + 1
      }
      searchPosition = Math.ceil((upperBound - lowerBound) / 2) + lowerBound
      comparison = compare(entries[searchPosition], entries[searchPosition + 1])
    }

    // here's where we read forward
    relevant.push(entries[searchPosition])
    let i = searchPosition + 1
    for (; i < entries.length; i += 1) {
      relevant.push(entries[i])
      if (entries[i][UNCOMPRESSED_POSITION] >= endPosition) break
    }
    if (relevant[relevant.length - 1][UNCOMPRESSED_POSITION] < endPosition) {
      relevant.push([])
    }
    return relevant
  }

  // /**
  //  * get a virtual block record giving the position and length of a BGZF region that
  //  * must be read to execute the given virtual read operation
  //  *
  //  * @param {number} position uncompressed file position we would like to start reading at
  //  * @param {number} length number of uncompressed bytes we would like to read
  //  * @returns {object} as `{compressedPosition, uncompressedPosition, compressedSize}`. If
  //  * compressedSize is undefined, the read should end at the end of the file.
  //  */
  // async calculateMultiBlockRead(position, length) {
  //   const entries = await this._getIndex()
  //   const endPosition = position + length
  //   let readStart
  //   let readLength
  //   let readUncompressedStart
  //   for (let i = 0; i < entries.length; i += 1) {
  //     const entry = entries[i]
  //     if (readStart === undefined && entry.uncompressedPosition <= position) {
  //       readStart = entry.compressedPosition
  //       readUncompressedStart = entry.uncompressedPosition
  //     }
  //     if (
  //       readLength === undefined &&
  //       entry.uncompressedPosition >= endPosition
  //     ) {
  //       readLength = entry.compressedPosition - readStart
  //     }
  //   }

  //   return {
  //     compressedPosition: readStart,
  //     uncompressedPosition: readUncompressedStart,
  //     compressedSize: readLength,
  //   }
  // }
}

module.exports = GziIndex
