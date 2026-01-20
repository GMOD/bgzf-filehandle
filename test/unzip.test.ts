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

// Tests for large file position support (>4GB files using f64 instead of u32)
test('cpositions preserve precision for values that would overflow u32', async () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  const { cpositions, dpositions } = await unzipChunkSlice(testData, {
    minv: { dataPosition: 0, blockPosition: 0 },
    maxv: { dataPosition: 100, blockPosition: 0 },
  })

  // Verify cpositions and dpositions are arrays of numbers (from Float64Array)
  expect(Array.isArray(cpositions)).toBe(true)
  expect(Array.isArray(dpositions)).toBe(true)
  expect(cpositions.length).toBeGreaterThan(0)
  expect(dpositions.length).toBeGreaterThan(0)

  // Verify all values are finite numbers
  for (const pos of cpositions) {
    expect(typeof pos).toBe('number')
    expect(Number.isFinite(pos)).toBe(true)
  }
  for (const pos of dpositions) {
    expect(typeof pos).toBe('number')
    expect(Number.isFinite(pos)).toBe(true)
  }
})

test('f64 can represent positions beyond u32 max (4GB boundary)', () => {
  // This test verifies that JavaScript numbers (f64) can precisely represent
  // file positions larger than what u32 could handle (2^32 = 4,294,967,296)

  const u32Max = 2 ** 32 // 4,294,967,296
  const largePosition = u32Max + 12345 // A position beyond 4GB

  // f64 can precisely represent integers up to 2^53 (Number.MAX_SAFE_INTEGER)
  expect(largePosition).toBe(4294979641)
  expect(Number.isSafeInteger(largePosition)).toBe(true)

  // Verify no precision loss when stored as f64
  const asFloat = largePosition
  expect(asFloat).toBe(largePosition)

  // Verify positions up to ~9 petabytes can be represented precisely
  const maxSafePosition = Number.MAX_SAFE_INTEGER // 2^53 - 1
  expect(Number.isSafeInteger(maxSafePosition)).toBe(true)
})

test('large blockPosition is preserved in cpositions (>4GB file support)', async () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))

  // Simulate reading from a position >4GB in a large file.
  // The input buffer represents data fetched starting at largePosition.
  // The cpositions should correctly reflect the large starting position.
  const largePosition = 2 ** 40 // 1 TB position

  const { buffer, cpositions } = await unzipChunkSlice(testData, {
    minv: { dataPosition: 0, blockPosition: largePosition },
    maxv: { dataPosition: 100, blockPosition: largePosition },
  })

  expect(buffer.length).toBeGreaterThan(0)
  expect(cpositions.length).toBeGreaterThan(0)

  // The first cposition should be the large starting position (not truncated)
  expect(cpositions[0]).toBe(largePosition)

  // Verify it's actually a large number, not truncated to 32-bit
  expect(cpositions[0]).toBeGreaterThan(2 ** 32)
})

test('positions just above 4GB boundary are handled correctly', async () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))

  // Position just above the 4GB (2^32) boundary
  const position = 2 ** 32 + 12345

  const { cpositions, dpositions } = await unzipChunkSlice(testData, {
    minv: { dataPosition: 0, blockPosition: position },
    maxv: { dataPosition: 100, blockPosition: position },
  })

  expect(cpositions.length).toBeGreaterThan(0)
  expect(dpositions.length).toBeGreaterThan(0)

  // Verify the position is preserved exactly (not truncated)
  expect(cpositions[0]).toBe(position)
  expect(Number.isSafeInteger(cpositions[0])).toBe(true)
})

test('cpositions increment correctly from large starting position', async () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))

  // Use a large starting position
  const startPosition = 5_000_000_000_000 // 5 TB

  const { cpositions } = await unzipChunkSlice(testData, {
    minv: { dataPosition: 0, blockPosition: startPosition },
    maxv: { dataPosition: 65535, blockPosition: startPosition + 50000 },
  })

  // Should have multiple block positions
  expect(cpositions.length).toBeGreaterThan(1)

  // First position should be the starting position
  expect(cpositions[0]).toBe(startPosition)

  // Subsequent positions should be increasing
  for (let i = 1; i < cpositions.length; i++) {
    expect(cpositions[i]).toBeGreaterThan(cpositions[i - 1]!)
  }

  // All positions should be large (>5TB)
  for (const pos of cpositions) {
    expect(pos).toBeGreaterThan(startPosition - 1)
  }
})
