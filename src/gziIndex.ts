import { longFromBytesToUnsigned } from './long.ts'

import type { GenericFilehandle } from 'generic-filehandle2'

export default class GziIndex {
  filehandle: GenericFilehandle

  index?: Promise<[number, number][]>

  constructor({ filehandle }: { filehandle: GenericFilehandle }) {
    this.filehandle = filehandle
  }

  _getIndex() {
    if (!this.index) {
      this.index = this._readIndex().catch((error: unknown) => {
        this.index = undefined
        throw error
      })
    }
    return this.index
  }

  async _readIndex(): Promise<[number, number][]> {
    const buf = await this.filehandle.read(8, 0)
    const numEntries = longFromBytesToUnsigned(buf)
    if (numEntries === 0) {
      return [[0, 0]]
    }
    if (numEntries > Number.MAX_SAFE_INTEGER / 16) {
      throw new TypeError('integer overflow')
    }

    const entries: [number, number][] = new Array(numEntries + 1)
    entries[0] = [0, 0]

    const b2 = await this.filehandle.read(16 * numEntries, 8)
    for (let entryNumber = 0; entryNumber < numEntries; entryNumber += 1) {
      entries[entryNumber + 1] = [
        longFromBytesToUnsigned(b2, entryNumber * 16),
        longFromBytesToUnsigned(b2, entryNumber * 16 + 8),
      ]
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
  ): Promise<{
    blocks: [number, number][]
    nextCompressedPosition: number | undefined
  }> {
    if (length === 0) {
      return { blocks: [], nextCompressedPosition: undefined }
    }
    const entries = await this._getIndex()
    const endPosition = position + length

    // find the first block whose uncompressed start is > position; the
    // block before it is the one containing position
    let lo = 0
    let hi = entries.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (entries[mid]![1] <= position) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    const startBlock = lo - 1

    let endBlock = startBlock + 1
    while (endBlock < entries.length && entries[endBlock]![1] < endPosition) {
      endBlock += 1
    }
    return {
      blocks: entries.slice(startBlock, endBlock),
      nextCompressedPosition: entries[endBlock]?.[0],
    }
  }
}
