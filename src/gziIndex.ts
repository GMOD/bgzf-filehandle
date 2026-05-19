import { longFromBytesToUnsigned } from './long.ts'

import type { GenericFilehandle } from 'generic-filehandle2'

const ENTRY_SIZE = 16

function parseEntries(buf: Uint8Array, numEntries: number) {
  const entries: [number, number][] = new Array(numEntries + 1)
  entries[0] = [0, 0]
  for (let i = 0; i < numEntries; i += 1) {
    const offset = i * ENTRY_SIZE
    entries[i + 1] = [
      longFromBytesToUnsigned(buf, offset),
      longFromBytesToUnsigned(buf, offset + 8),
    ]
  }
  return entries
}

// lower-bound binary search: first index whose uncompressed start > position
function findUpperBound(entries: [number, number][], position: number) {
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
  return lo
}

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
    const header = await this.filehandle.read(8, 0)
    const numEntries = longFromBytesToUnsigned(header)
    if (numEntries === 0) {
      return [[0, 0]]
    }
    if (numEntries > Number.MAX_SAFE_INTEGER / ENTRY_SIZE) {
      throw new TypeError('integer overflow')
    }
    const body = await this.filehandle.read(ENTRY_SIZE * numEntries, 8)
    return parseEntries(body, numEntries)
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
    const readEnd = position + length

    const startBlock = findUpperBound(entries, position) - 1
    let endBlock = startBlock + 1
    while (endBlock < entries.length && entries[endBlock]![1] < readEnd) {
      endBlock += 1
    }
    return {
      blocks: entries.slice(startBlock, endBlock),
      nextCompressedPosition: entries[endBlock]?.[0],
    }
  }
}
