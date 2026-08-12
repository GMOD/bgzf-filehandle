import fs from 'node:fs'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installFakeWorker } from './fakeWorker.ts'
import { unzipChunkSlice } from '../src/unzip.ts'
import {
  createBgzfWorkerPool,
  destroySharedWorkerPool,
  getSharedWorkerPool,
} from '../src/workerPool.ts'

beforeEach(() => {
  destroySharedWorkerPool()
})

afterEach(() => {
  vi.unstubAllGlobals()
  destroySharedWorkerPool()
})

// The pool's requirement is a Worker to run in. Under node there is no Worker,
// which is what these first two assert. See the browser suite for the case
// that matters — a real page, served without cross-origin isolation.

test('getSharedWorkerPool resolves to undefined where workers are unavailable', async () => {
  vi.stubGlobal('Worker', undefined)
  const pool = await getSharedWorkerPool()
  expect(pool).toBeUndefined()
})

test('createBgzfWorkerPool throws a helpful error where workers are unavailable', async () => {
  vi.stubGlobal('Worker', undefined)
  await expect(createBgzfWorkerPool()).rejects.toThrow(/no Worker/)
})

test('unzipChunkSlice works without a pool (sequential fallback)', async () => {
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  const chunk = {
    minv: { dataPosition: 0, blockPosition: 0 },
    maxv: { dataPosition: 100, blockPosition: 1 },
  }
  const { buffer, cpositions, dpositions } = await unzipChunkSlice(
    testData,
    chunk,
  )
  expect(buffer.length).toBeGreaterThan(0)
  expect(cpositions.length).toBeGreaterThan(0)
  expect(dpositions.length).toBeGreaterThan(0)
})

test('recommended JBrowse-style pattern: await getSharedWorkerPool() then pass to unzipChunkSlice', async () => {
  vi.stubGlobal('Worker', undefined)
  const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
  const chunk = {
    minv: { dataPosition: 0, blockPosition: 0 },
    maxv: { dataPosition: 100, blockPosition: 1 },
  }

  const pool = await getSharedWorkerPool()
  const sequential = await unzipChunkSlice(testData, chunk)
  const viaPool = await unzipChunkSlice(testData, chunk, pool)

  expect(pool).toBeUndefined()
  expect(viaPool.buffer).toEqual(sequential.buffer)
  expect(viaPool.cpositions).toEqual(sequential.cpositions)
  expect(viaPool.dpositions).toEqual(sequential.dpositions)
})

test('pool takes the transferable path and leaves the caller its bytes', async () => {
  const { posted } = installFakeWorker()

  const testData = new Uint8Array(
    fs.readFileSync(require.resolve('./data/paired.bam')),
  )
  const chunk = {
    minv: { dataPosition: 0, blockPosition: 0 },
    maxv: { dataPosition: 65535, blockPosition: testData.length },
  }

  const pool = await createBgzfWorkerPool(2)
  const before = testData.byteLength
  const sequential = await unzipChunkSlice(testData, chunk)
  const viaPool = await unzipChunkSlice(testData, chunk, pool)

  expect(posted.length).toBeGreaterThan(0)
  expect(posted.every(p => p.hadInputBuffer)).toBe(true)
  // the pool copies each worker's range out, so the caller's buffer is intact
  expect(testData.byteLength).toBe(before)
  expect(viaPool.buffer).toEqual(sequential.buffer)
  expect([...viaPool.cpositions]).toEqual([...sequential.cpositions])
  expect([...viaPool.dpositions]).toEqual([...sequential.dpositions])
  pool.destroy()
})
