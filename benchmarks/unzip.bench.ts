import { readFileSync } from 'node:fs'
import { bench, describe } from 'vitest'

import { unzip as unzipBranch1 } from '../esm_branch1/unzip.js'
import { unzip as unzipBranch2 } from '../esm_branch2/unzip.js'

const branch1Name = readFileSync('esm_branch1/branchname.txt', 'utf8').trim()
const branch2Name = readFileSync('esm_branch2/branchname.txt', 'utf8').trim()

const tkoData = new Uint8Array(readFileSync('test/data/T_ko.2bit.gz'))
const gffData = new Uint8Array(readFileSync('test/data/out.sorted.gff.gz'))

describe('unzip T_ko.2bit.gz (518KB)', () => {
  bench(branch1Name, async () => {
    await unzipBranch1(tkoData)
  })

  bench(branch2Name, async () => {
    await unzipBranch2(tkoData)
  })
})

describe('unzip out.sorted.gff.gz (5.2MB)', () => {
  bench(branch1Name, async () => {
    await unzipBranch1(gffData)
  })

  bench(branch2Name, async () => {
    await unzipBranch2(gffData)
  })
})
