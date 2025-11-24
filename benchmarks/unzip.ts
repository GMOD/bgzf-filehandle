import { readFileSync } from 'node:fs'
import { bench, describe } from 'vitest'

import { unzip } from '../src/unzip.ts'

const inputData = new Uint8Array(readFileSync('test/data/T_ko.2bit.gz'))

describe('unzip', () => {
  bench('T_ko.2bit.gz', async () => {
    await unzip(inputData)
  })
})
