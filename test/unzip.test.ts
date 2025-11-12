import fs from 'fs'

import { expect, test, vi } from 'vitest'

import { unzip, unzipChunkSlice } from '../src/unzip.ts'

test('can unzip bgzip-1.txt.gz', async () => {
  const testData = fs.readFileSync(require.resolve('./data/bgzip-1.txt.gz'))
  const fromPako = await unzip(testData)
  expect(fromPako.length).toEqual(65569)
})

test('test error message modification', async () => {
  const originalWarn = console.warn
  console.warn = vi.fn()
  const testData = fs.readFileSync(require.resolve('./data/bgzip-1.txt.gz'))

  await expect(unzip(testData.subarray(2))).rejects.toThrow(
    /problem decompressing block/,
  )
  console.warn = originalWarn
})

test('can unzip bgzip-1.txt.gz', async () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  const { dpositions, cpositions } = await unzipChunkSlice(testData, {
    minv: { dataPosition: 0, blockPosition: 0 },
    maxv: { dataPosition: 100, blockPosition: 0 },
  })
  expect(dpositions).toMatchSnapshot()
  expect(cpositions).toMatchSnapshot()
})
test('can unzip bgzip-1.txt.gz positive minv.dataPosition', async () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  const { dpositions, cpositions } = await unzipChunkSlice(testData, {
    minv: { dataPosition: 50, blockPosition: 0 },
    maxv: { dataPosition: 100, blockPosition: 0 },
  })
  expect(dpositions).toMatchSnapshot()
  expect(cpositions).toMatchSnapshot()
})
test('can unzip bgzip-1.txt.gz positive maxv.blockPosition', async () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  const { dpositions, cpositions } = await unzipChunkSlice(testData, {
    minv: { dataPosition: 50, blockPosition: 0 },
    maxv: { dataPosition: 100, blockPosition: 1 },
  })
  expect(dpositions).toMatchSnapshot()
  expect(cpositions).toMatchSnapshot()
})

test('test error message modification', async () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  await expect(
    unzipChunkSlice(testData.slice(2), {
      minv: { dataPosition: 40, blockPosition: 0 },
      maxv: { dataPosition: 100, blockPosition: 0 },
    }),
  ).rejects.toThrow(/problem decompressing block/)
})
