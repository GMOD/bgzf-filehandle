import fs from 'node:fs'

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
  const firstTwoBlocks = scanBgzfBlocks(testData, 0, allBlocks[1]!.filePosition)
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

test('scanBgzfBlocks returns empty for empty input', () => {
  const blocks = scanBgzfBlocks(new Uint8Array(0), 0, 0)
  expect(blocks).toEqual([])
})

test('scanBgzfBlocks returns empty for input shorter than min block size', () => {
  const blocks = scanBgzfBlocks(new Uint8Array(25), 0, 100)
  expect(blocks).toEqual([])
})

test('scanBgzfBlocks stops on truncated block', () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  const allBlocks = scanBgzfBlocks(testData, 0, testData.length)
  const firstBlockSize = allBlocks[0]!.compressedSize

  // truncate in the middle of the second block
  const truncated = testData.subarray(0, firstBlockSize + 10)
  const blocks = scanBgzfBlocks(truncated, 0, truncated.length)
  expect(blocks.length).toBe(1)
  expect(blocks[0]!.compressedSize).toBe(firstBlockSize)
})

test('scanBgzfBlocks stops on non-bgzf data', () => {
  const blocks = scanBgzfBlocks(new Uint8Array(1000), 0, 1000)
  expect(blocks).toEqual([])
})

test('scanBgzfBlocks includes block at maxBlockPosition', () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  const allBlocks = scanBgzfBlocks(testData, 0, testData.length)
  // set maxBlockPosition to exactly the second block's position
  const secondBlockPos = allBlocks[1]!.filePosition
  const blocks = scanBgzfBlocks(testData, 0, secondBlockPos)
  // should include the block at maxBlockPosition (inclusive)
  expect(blocks.length).toBe(2)
  expect(blocks[1]!.filePosition).toBe(secondBlockPos)
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
