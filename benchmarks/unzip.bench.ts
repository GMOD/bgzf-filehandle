import { readFileSync } from 'node:fs'
import { bench, describe } from 'vitest'

import { unzip as unzipBranch1 } from '../esm_branch1/unzip.js'
import { unzip as unzipBranch2 } from '../esm_branch2/unzip.js'

const branches = [
  {
    name: readFileSync('esm_branch1/branchname.txt', 'utf8').trim(),
    unzip: unzipBranch1,
  },
  {
    name: readFileSync('esm_branch2/branchname.txt', 'utf8').trim(),
    unzip: unzipBranch2,
  },
]

const testFiles = [
  {
    path: 'test/data/T_ko.2bit.gz',
    label: 'T_ko.2bit.gz (518KB)',
    iterations: 100,
  },
  {
    path: 'test/data/out.sorted.gff.gz',
    label: 'out.sorted.gff.gz (5.2MB)',
    iterations: 20,
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
