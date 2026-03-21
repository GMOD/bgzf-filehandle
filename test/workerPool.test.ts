import fs from 'fs'

import { expect, test } from 'vitest'

import { scanBgzfBlocks } from '../src/bgzfBlockScan.ts'

test('scanBgzfBlocks finds correct block boundaries in paired.bam', () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  const blocks = scanBgzfBlocks(testData, 0, testData.length)
  expect(blocks.length).toBeGreaterThan(1)

  for (const block of blocks) {
    expect(block.compressedSize).toBeGreaterThan(0)
    expect(block.decompressedSize).toBeGreaterThanOrEqual(0)
    expect(block.inputOffset).toBeGreaterThanOrEqual(0)
  }

  let offset = 0
  for (const block of blocks) {
    expect(block.inputOffset).toBe(offset)
    offset += block.compressedSize
  }
})

test('scanBgzfBlocks respects maxBlockPosition', () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  const allBlocks = scanBgzfBlocks(testData, 0, testData.length)
  const firstTwoBlocks = scanBgzfBlocks(
    testData,
    0,
    allBlocks[1]!.filePosition,
  )
  expect(firstTwoBlocks.length).toBe(2)
})

test('scanBgzfBlocks on T_ko.2bit.gz', () => {
  const testData = fs.readFileSync(require.resolve('./data/T_ko.2bit.gz'))
  const blocks = scanBgzfBlocks(testData, 0, testData.length)
  expect(blocks.length).toBeGreaterThan(5)

  let totalDecompressed = 0
  for (const block of blocks) {
    totalDecompressed += block.decompressedSize
  }
  expect(totalDecompressed).toBeGreaterThan(0)
})

test('scanBgzfBlocks with large filePosition offset', () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  const startPos = 5_000_000_000_000
  const blocks = scanBgzfBlocks(testData, startPos, startPos + testData.length)

  expect(blocks[0]!.filePosition).toBe(startPos)
  for (let i = 1; i < blocks.length; i++) {
    expect(blocks[i]!.filePosition).toBeGreaterThan(blocks[i - 1]!.filePosition)
  }
})
