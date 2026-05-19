import { LocalFile } from 'generic-filehandle2'
import { describe, expect, it } from 'vitest'

import GziIndex from '../src/gziIndex.ts'

describe('gzi objects', () => {
  it('can read empty gff3_with_syncs.gff3.gz.gzi', async () => {
    const idx = new GziIndex({
      filehandle: new LocalFile(
        require.resolve('./data/gff3_with_syncs.gff3.gz.gzi'),
      ),
    })
    expect(await idx._getIndex()).toEqual([[0, 0]])
  })
  it('can read T_ko.2bit.gz.gzi', async () => {
    const idx = new GziIndex({
      filehandle: new LocalFile(require.resolve('./data/T_ko.2bit.gz.gzi')),
    })
    expect(await idx._getIndex()).toEqual([
      [0, 0],
      [64791, 65280],
      [129553, 130560],
      [194448, 195840],
      [259166, 261120],
      [324086, 326400],
      [389021, 391680],
      [453884, 456960],
    ])

    expect(await idx.getRelevantBlocksForRead(100000, 0)).toEqual({
      blocks: [
        [0, 0],
        [64791, 65280],
      ],
      nextCompressedPosition: 129553,
    })

    expect(await idx.getRelevantBlocksForRead(1, 100000)).toEqual({
      blocks: [[64791, 65280]],
      nextCompressedPosition: 129553,
    })

    expect(await idx.getRelevantBlocksForRead(0, 100000)).toEqual({
      blocks: [],
      nextCompressedPosition: undefined,
    })

    expect(await idx.getRelevantBlocksForRead(500000, 300000)).toEqual({
      blocks: [
        [259166, 261120],
        [324086, 326400],
        [389021, 391680],
        [453884, 456960],
      ],
      nextCompressedPosition: undefined,
    })

    expect(await idx.getRelevantBlocksForRead(10, 500000)).toEqual({
      blocks: [[453884, 456960]],
      nextCompressedPosition: undefined,
    })
  })
})
