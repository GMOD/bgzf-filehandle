import { readFileSync } from 'node:fs'
import { bench, describe } from 'vitest'

import { unzip as unzipBranch1 } from '../esm_branch1/unzip.js'
import { unzip as unzipBranch2 } from '../esm_branch2/unzip.js'
import { unzipChunkSlice as unzipChunkSliceBranch1 } from '../esm_branch1/unzip.js'
import { unzipChunkSlice as unzipChunkSliceBranch2 } from '../esm_branch2/unzip.js'

const branches = [
  {
    name: readFileSync('esm_branch1/branchname.txt', 'utf8').trim(),
    unzip: unzipBranch1,
    unzipChunkSlice: unzipChunkSliceBranch1,
  },
  {
    name: readFileSync('esm_branch2/branchname.txt', 'utf8').trim(),
    unzip: unzipBranch2,
    unzipChunkSlice: unzipChunkSliceBranch2,
  },
]

const testFiles = [
  {
    path: 'test/data/T_ko.2bit.gz',
    label: 'T_ko.2bit.gz (518KB)',
    iterations: 1000,
  },
  {
    path: 'test/data/out.sorted.gff.gz',
    label: 'out.sorted.gff.gz (5.2MB)',
    iterations: 100,
  },
]

for (const { path, label, iterations } of testFiles) {
  const data = new Uint8Array(readFileSync(path))
  describe(`unzip ${label}`, () => {
    for (const { name, unzip } of branches) {
      bench(
        name,
        async () => {
          await unzip(data)
        },
        { iterations },
      )
    }
  })
}

const chunkSliceTestFiles = [
  {
    path: 'test/data/paired.bam',
    label: 'paired.bam (84KB) - single block',
    iterations: 5000,
    chunk: {
      minv: { blockPosition: 0, dataPosition: 0 },
      maxv: { blockPosition: 0, dataPosition: 1000 },
    },
  },
  {
    path: 'test/data/paired.bam',
    label: 'paired.bam (84KB) - all blocks',
    iterations: 2000,
    chunk: {
      minv: { blockPosition: 0, dataPosition: 0 },
      maxv: { blockPosition: 83000, dataPosition: 65535 },
    },
  },
  {
    path: 'test/data/T_ko.2bit.gz',
    label: 'T_ko.2bit.gz (518KB) - first 10 blocks',
    iterations: 1000,
    chunk: {
      minv: { blockPosition: 0, dataPosition: 0 },
      maxv: { blockPosition: 50000, dataPosition: 65535 },
    },
  },
  {
    path: 'test/data/T_ko.2bit.gz',
    label: 'T_ko.2bit.gz (518KB) - all blocks',
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
    for (const { name, unzipChunkSlice } of branches) {
      bench(
        name,
        async () => {
          await unzipChunkSlice(data, chunk)
        },
        { iterations },
      )
    }
  })
}
