import fs from 'node:fs'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

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

test('getSharedWorkerPool resolves to undefined when SharedArrayBuffer is unavailable', async () => {
  vi.stubGlobal('SharedArrayBuffer', undefined)
  const pool = await getSharedWorkerPool()
  expect(pool).toBeUndefined()
})

test('createBgzfWorkerPool throws a helpful error when SharedArrayBuffer is unavailable', async () => {
  vi.stubGlobal('SharedArrayBuffer', undefined)
  await expect(createBgzfWorkerPool()).rejects.toThrow(
    /SharedArrayBuffer is not available/,
  )
})

test('unzipChunkSlice works without a pool (sequential fallback) when SharedArrayBuffer is unavailable', async () => {
  vi.stubGlobal('SharedArrayBuffer', undefined)
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
  vi.stubGlobal('SharedArrayBuffer', undefined)
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
