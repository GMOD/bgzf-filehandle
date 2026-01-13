import { readFileSync } from 'node:fs'
import { bench, describe } from 'vitest'

import { unzip, unzipChunkSlice } from '../esm/unzip.js'

const testFiles = [
  {
    path: 'test/data/T_ko.2bit.gz',
    label: 'T_ko.2bit.gz (518KB)',
    iterations: 500,
  },
  {
    path: 'test/data/out.sorted.gff.gz',
    label: 'out.sorted.gff.gz (5.2MB)',
    iterations: 50,
  },
]

for (const { path, label, iterations } of testFiles) {
  const data = new Uint8Array(readFileSync(path))
  describe(`unzip ${label}`, () => {
    bench(
      'current',
      async () => {
        await unzip(data)
      },
      { iterations, warmupIterations: 10 },
    )
  })
}

const chunkSliceTestFiles = [
  {
    path: 'test/data/paired.bam',
    label: 'paired.bam - single block',
    iterations: 5000,
    chunk: {
      minv: { blockPosition: 0, dataPosition: 0 },
      maxv: { blockPosition: 0, dataPosition: 1000 },
    },
  },
  {
    path: 'test/data/paired.bam',
    label: 'paired.bam - all blocks',
    iterations: 2000,
    chunk: {
      minv: { blockPosition: 0, dataPosition: 0 },
      maxv: { blockPosition: 83000, dataPosition: 65535 },
    },
  },
  {
    path: 'test/data/T_ko.2bit.gz',
    label: 'T_ko.2bit.gz - all blocks',
    iterations: 500,
    chunk: {
      minv: { blockPosition: 0, dataPosition: 0 },
      maxv: { blockPosition: 518000, dataPosition: 65535 },
    },
  },
]

for (const { path, label, iterations, chunk } of chunkSliceTestFiles) {
  const data = new Uint8Array(readFileSync(path))
  describe(`unzipChunkSlice ${label}`, () => {
    bench(
      'current',
      async () => {
        await unzipChunkSlice(data, chunk)
      },
      { iterations, warmupIterations: 10 },
    )
  })
}
