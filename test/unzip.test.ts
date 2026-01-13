import fs from 'fs'

import { expect, test } from 'vitest'

import { unzip, unzipChunkSlice } from '../src/unzip.ts'

test('can unzip bgzip-1.txt.gz', async () => {
  const testData = fs.readFileSync(require.resolve('./data/bgzip-1.txt.gz'))
  const fromPako = await unzip(testData)
  expect(fromPako.length).toEqual(65569)
})

test('test error message modification', async () => {
  const testData = fs.readFileSync(require.resolve('./data/bgzip-1.txt.gz'))

  await expect(unzip(testData.slice(2))).rejects.toThrow(
    /not a valid bgzf or gzip block/,
  )
})

test('can unzip bgzip-1.txt.gz', async () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  const { dpositions, cpositions } = await unzipChunkSlice(testData, {
    minv: { dataPosition: 0, blockPosition: 0 },
    maxv: { dataPosition: 100, blockPosition: 0 },
  })
  expect([...dpositions]).toEqual([0, 22579])
  expect([...cpositions]).toEqual([0, 4682])
})
test('can unzip bgzip-1.txt.gz positive minv.dataPosition', async () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  const { dpositions, cpositions } = await unzipChunkSlice(testData, {
    minv: { dataPosition: 50, blockPosition: 0 },
    maxv: { dataPosition: 100, blockPosition: 0 },
  })
  expect([...dpositions]).toEqual([50, 22579])
  expect([...cpositions]).toEqual([0, 4682])
})
test('can unzip bgzip-1.txt.gz positive maxv.blockPosition', async () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  const { dpositions, cpositions } = await unzipChunkSlice(testData, {
    minv: { dataPosition: 50, blockPosition: 0 },
    maxv: { dataPosition: 100, blockPosition: 1 },
  })
  expect([...dpositions]).toEqual([50, 22579, 87646])
  expect([...cpositions]).toEqual([0, 4682, 24403])
})

test('test error message modification', async () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  await expect(
    unzipChunkSlice(testData.slice(2), {
      minv: { dataPosition: 40, blockPosition: 0 },
      maxv: { dataPosition: 100, blockPosition: 0 },
    }),
  ).rejects.toThrow(/invalid bgzf header/)
})

test('can unzip plain gzip file (non-bgzf)', async () => {
  const testData = fs.readFileSync(
    require.resolve('./data/plain-gzip-test.txt.gz'),
  )
  const result = await unzip(testData)
  const text = new TextDecoder().decode(result)
  expect(text).toBe('Hello, this is a plain gzip test file.\n')
})
