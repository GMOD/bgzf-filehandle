import { LocalFile, GenericFilehandle } from 'generic-filehandle2'
import { toNumber, fromBytesLE } from 'longfn'

const UNCOMPRESSED_POSITION = 1

// binary search to find the block that the
// read starts in and extend forward from that
function compare(
  position: number,
  entry: [number, number],
  nextEntry?: [number, number],
) {
  const uncompressedPosition = entry[UNCOMPRESSED_POSITION]
  const nextUncompressedPosition = nextEntry
    ? nextEntry[UNCOMPRESSED_POSITION]
    : Infinity
  if (uncompressedPosition <= position && nextUncompressedPosition > position) {
    // block overlaps read start
    return 0
  } else if (uncompressedPosition < position) {
    // block is before read start
    return -1
  } else {
    // block is after read start
    return 1
  }
}

export default class GziIndex {
  filehandle: GenericFilehandle

  index?: Promise<[number, number][]>

  constructor({
    filehandle,
    path,
  }: {
    filehandle?: GenericFilehandle
    path?: string
  }) {
    if (filehandle) {
      this.filehandle = filehandle
    } else if (path) {
      this.filehandle = new LocalFile(path)
    } else {
      throw new TypeError('either filehandle or path must be defined')
    }
  }

  _getIndex() {
    if (!this.index) {
      this.index = this._readIndex().catch((e: unknown) => {
        this.index = undefined
        throw e
      })
    }
    return this.index
  }

  async _readIndex(): Promise<[number, number][]> {
    const buf = await this.filehandle.read(8, 0)
    const numEntries = toNumber(fromBytesLE(buf.subarray(0, 8), true))
    if (!numEntries) {
      return [[0, 0]]
    }

    const entries = new Array(numEntries + 1)
    entries[0] = [0, 0]

    // TODO rewrite this to make an index-index that stays in memory
    const bufSize = 8 * 2 * numEntries
    if (bufSize > Number.MAX_SAFE_INTEGER) {
      throw new TypeError('integer overflow')
    }
    const buf2 = await this.filehandle.read(bufSize, 8)
    for (let entryNumber = 0; entryNumber < numEntries; entryNumber += 1) {
      const compressedPosition = toNumber(
        fromBytesLE(
          buf2.subarray(entryNumber * 16, entryNumber * 16 + 8),
          true,
        ),
      )
      const uncompressedPosition = toNumber(
        fromBytesLE(
          buf2.subarray(entryNumber * 16 + 8, entryNumber * 16 + 16),
          true,
        ),
      )
      entries[entryNumber + 1] = [compressedPosition, uncompressedPosition]
    }

    return entries
  }

  async getLastBlock() {
    const entries = await this._getIndex()
    return entries.at(-1)
  }

  async getRelevantBlocksForRead(
    length: number,
    position: number,
  ): Promise<([number, number] | never[])[]> {
    const endPosition = position + length
    if (length === 0) {
      return []
    }
    const entries = await this._getIndex()
    const relevant = []

    let lowerBound = 0
    let upperBound = entries.length - 1
    let searchPosition = Math.floor(entries.length / 2)

    let comparison = compare(
      position,
      entries[searchPosition]!,
      entries[searchPosition + 1],
    )
    while (comparison !== 0) {
      if (comparison > 0) {
        upperBound = searchPosition - 1
      } else if (comparison < 0) {
        lowerBound = searchPosition + 1
      }
      searchPosition = Math.ceil((upperBound - lowerBound) / 2) + lowerBound
      comparison = compare(
        position,
        entries[searchPosition]!,
        entries[searchPosition + 1],
      )
    }

    // here's where we read forward
    relevant.push(entries[searchPosition]!)
    let i = searchPosition + 1
    for (; i < entries.length; i += 1) {
      relevant.push(entries[i]!)
      if (entries[i]![UNCOMPRESSED_POSITION] >= endPosition) {
        break
      }
    }
    if (relevant[relevant.length - 1]![UNCOMPRESSED_POSITION] < endPosition) {
      relevant.push([])
    }
    return relevant
  }
}
