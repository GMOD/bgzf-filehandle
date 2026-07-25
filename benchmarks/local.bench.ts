// Benchmarks src/ directly (no branch-comparison build needed).
// Run: npx vitest bench benchmarks/local.bench.ts
import { readFileSync } from 'node:fs'

import { LocalFile } from 'generic-filehandle2'
import { bench, describe } from 'vitest'

import BgzFilehandle from '../src/bgzFilehandle.ts'
import { unzip, unzipChunkSlice } from '../src/unzip.ts'

const gff = new Uint8Array(readFileSync('test/data/out.sorted.gff.gz'))
const twobit = new Uint8Array(readFileSync('test/data/T_ko.2bit.gz'))
const bam = new Uint8Array(readFileSync('test/data/paired.bam'))
const plainGz = new Uint8Array(readFileSync('test/data/plain-gzip-test.txt.gz'))

describe('unzip whole file', () => {
  bench('out.sorted.gff.gz 5.2MB', async () => {
    await unzip(gff)
  })
  bench('T_ko.2bit.gz 518KB', async () => {
    await unzip(twobit)
  })
})

describe('unzip plain gzip (non-bgzf fallback)', () => {
  bench('plain-gzip-test.txt.gz', async () => {
    await unzip(plainGz)
  })
})

describe('unzipChunkSlice', () => {
  bench('paired.bam all blocks', async () => {
    await unzipChunkSlice(bam, {
      minv: { blockPosition: 0, dataPosition: 0 },
      maxv: { blockPosition: 83000, dataPosition: 65535 },
    })
  })
  bench('paired.bam single block x100', async () => {
    for (let i = 0; i < 100; i++) {
      await unzipChunkSlice(bam.subarray(0, 70000), {
        minv: { blockPosition: 0, dataPosition: 0 },
        maxv: { blockPosition: 0, dataPosition: 1000 },
      })
    }
  })
})

describe('BgzFilehandle.read', () => {
  const make = () =>
    new BgzFilehandle({
      filehandle: new LocalFile('test/data/T_ko.2bit.gz'),
      gziFilehandle: new LocalFile('test/data/T_ko.2bit.gz.gzi'),
    })

  bench('whole file, one read', async () => {
    await make().read(522226, 0)
  })
  bench('100 small random reads (shared handle)', async () => {
    const f = make()
    for (let i = 0; i < 100; i++) {
      await f.read(1000, (i * 5171) % 500000)
    }
  })
  bench('read spanning 4 blocks', async () => {
    await make().read(200000, 100000)
  })
})
