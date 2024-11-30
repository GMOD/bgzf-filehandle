import { describe, it, expect } from 'vitest'
import GziIndex from '../src/gziIndex'

describe('gzi objects', () => {
  it('can read empty gff3_with_syncs.gff3.gz.gzi', async () => {
    const idx = new GziIndex({
      path: require.resolve('./data/gff3_with_syncs.gff3.gz.gzi'),
    })
    expect(await idx._getIndex()).toEqual([[0, 0]])
  })
  it('can read T_ko.2bit.gz.gzi', async () => {
    const idx = new GziIndex({
      path: require.resolve('./data/T_ko.2bit.gz.gzi'),
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

    expect(await idx.getRelevantBlocksForRead(100000, 0)).toEqual([
      [0, 0],
      [64791, 65280],
      [129553, 130560],
    ])

    expect(await idx.getRelevantBlocksForRead(1, 100000)).toEqual([
      [64791, 65280],
      [129553, 130560],
    ])

    expect(await idx.getRelevantBlocksForRead(0, 100000)).toEqual([])

    expect(await idx.getRelevantBlocksForRead(500000, 300000)).toEqual([
      [259166, 261120],
      [324086, 326400],
      [389021, 391680],
      [453884, 456960],
      [],
    ])

    expect(await idx.getRelevantBlocksForRead(10, 500000)).toEqual([
      [453884, 456960],
      [],
    ])

    expect(await idx.getLastBlock()).toEqual([453884, 456960])
  })
})
