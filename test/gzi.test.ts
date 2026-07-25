import { LocalFile } from 'generic-filehandle2'
import { describe, expect, it } from 'vitest'

import GziIndex from '../src/gziIndex.ts'

// pairs up the parallel arrays so expectations stay readable
async function blocksFor(idx: GziIndex, length: number, position: number) {
  const { compressed, uncompressed, nextCompressedPosition } =
    await idx.getRelevantBlocksForRead(length, position)
  return {
    blocks: [...compressed].map((c, i) => [c, uncompressed[i]]),
    nextCompressedPosition,
  }
}

describe('gzi objects', () => {
  it('can read empty gff3_with_syncs.gff3.gz.gzi', async () => {
    const idx = new GziIndex({
      filehandle: new LocalFile(
        require.resolve('./data/gff3_with_syncs.gff3.gz.gzi'),
      ),
    })
    const { compressed, uncompressed } = await idx._getIndex()
    expect([...compressed]).toEqual([0])
    expect([...uncompressed]).toEqual([0])
  })
  it('can read T_ko.2bit.gz.gzi', async () => {
    const idx = new GziIndex({
      filehandle: new LocalFile(require.resolve('./data/T_ko.2bit.gz.gzi')),
    })
    const { compressed, uncompressed } = await idx._getIndex()
    expect([...compressed]).toEqual([
      0, 64791, 129553, 194448, 259166, 324086, 389021, 453884,
    ])
    expect([...uncompressed]).toEqual([
      0, 65280, 130560, 195840, 261120, 326400, 391680, 456960,
    ])

    expect(await blocksFor(idx, 100000, 0)).toEqual({
      blocks: [
        [0, 0],
        [64791, 65280],
      ],
      nextCompressedPosition: 129553,
    })

    expect(await blocksFor(idx, 1, 100000)).toEqual({
      blocks: [[64791, 65280]],
      nextCompressedPosition: 129553,
    })

    expect(await blocksFor(idx, 0, 100000)).toEqual({
      blocks: [],
      nextCompressedPosition: undefined,
    })

    expect(await blocksFor(idx, 500000, 300000)).toEqual({
      blocks: [
        [259166, 261120],
        [324086, 326400],
        [389021, 391680],
        [453884, 456960],
      ],
      nextCompressedPosition: undefined,
    })

    expect(await blocksFor(idx, 10, 500000)).toEqual({
      blocks: [[453884, 456960]],
      nextCompressedPosition: undefined,
    })
  })
})
