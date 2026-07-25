import { readUint64LE } from './long.ts'

import type { GenericFilehandle } from 'generic-filehandle2'

const ENTRY_SIZE = 16

// Block offsets are held as two parallel Float64Arrays rather than an array of
// [compressed, uncompressed] tuples. A gzi for a large file holds hundreds of
// thousands of entries, and one JS array object per entry costs roughly an
// order of magnitude more memory — plus GC pressure — than the packed form.
export interface GziEntries {
  compressed: Float64Array
  uncompressed: Float64Array
}

const EMPTY: GziEntries = {
  compressed: new Float64Array(0),
  uncompressed: new Float64Array(0),
}

function parseEntries(buf: Uint8Array, numEntries: number): GziEntries {
  // entry 0 is the implicit [0, 0] block start, already zeroed
  const compressed = new Float64Array(numEntries + 1)
  const uncompressed = new Float64Array(numEntries + 1)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  for (let i = 0; i < numEntries; i += 1) {
    const offset = i * ENTRY_SIZE
    compressed[i + 1] = readUint64LE(view, offset)
    uncompressed[i + 1] = readUint64LE(view, offset + 8)
  }
  return { compressed, uncompressed }
}

// lower-bound binary search: first index whose uncompressed start > position
function findUpperBound(uncompressed: Float64Array, position: number) {
  let lo = 0
  let hi = uncompressed.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (uncompressed[mid]! <= position) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

export default class GziIndex {
  filehandle: GenericFilehandle

  index?: Promise<GziEntries>

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

  private async _readIndex(): Promise<GziEntries> {
    const header = await this.filehandle.read(8, 0)
    const numEntries = readUint64LE(
      new DataView(header.buffer, header.byteOffset, header.byteLength),
    )
    if (numEntries === 0) {
      return parseEntries(new Uint8Array(0), 0)
    }
    if (numEntries > Number.MAX_SAFE_INTEGER / ENTRY_SIZE) {
      throw new TypeError('integer overflow')
    }
    const body = await this.filehandle.read(ENTRY_SIZE * numEntries, 8)
    return parseEntries(body, numEntries)
  }

  /**
   * The blocks covering [position, position+length), as zero-copy views into
   * the index, plus the compressed offset just past the last one. That offset
   * is undefined when the read reaches the final recorded block, since the gzi
   * doesn't record where it ends.
   */
  async getRelevantBlocksForRead(
    length: number,
    position: number,
  ): Promise<GziEntries & { nextCompressedPosition: number | undefined }> {
    if (length === 0) {
      return { ...EMPTY, nextCompressedPosition: undefined }
    }
    const { compressed, uncompressed } = await this._getIndex()

    const startBlock = findUpperBound(uncompressed, position) - 1
    // first block starting at or after the end of the read
    const endBlock = findUpperBound(uncompressed, position + length - 1)
    return {
      compressed: compressed.subarray(startBlock, endBlock),
      uncompressed: uncompressed.subarray(startBlock, endBlock),
      nextCompressedPosition:
        endBlock < compressed.length ? compressed[endBlock] : undefined,
    }
  }
}
