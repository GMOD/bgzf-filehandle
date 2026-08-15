// The layers above inflate, benchmarked against src/ directly (no
// branch-comparison build needed). Timing `unzip` on a BGZF file belongs in
// inflate.bench.ts, where there are pako and zlib arms to read it against.
//
// Run with `pnpm benchonly local`.
import { readFileSync } from 'node:fs'

import { LocalFile } from 'generic-filehandle2'
import { bench, describe } from 'vitest'

import BgzFilehandle from '../src/bgzFilehandle.ts'
import { unzip, unzipChunkSlice } from '../src/unzip.ts'

const bam = new Uint8Array(readFileSync('test/data/paired.bam'))
const plainGz = new Uint8Array(readFileSync('test/data/plain-gzip-test.txt.gz'))

// The one unzip arm that is not libdeflate: plain gzip falls back to pako.
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
