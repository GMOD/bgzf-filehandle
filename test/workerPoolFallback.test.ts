import fs from 'node:fs'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { unzipChunkSlice } from '../src/unzip.ts'
import { decompressAll } from '../src/wasm/bgzf-wasm-inlined.js'
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

/**
 * A stand-in for a real Worker that runs the same wasm on this thread.
 *
 * Lets the transferable protocol — the `inputBuffer` field, the transfer list,
 * and the caller's buffer surviving the call — be asserted in CI, where no
 * Worker exists. It deliberately does NOT emulate structured clone; the browser
 * suite covers what actually crosses a thread boundary.
 */
function installFakeWorker() {
  const posted: { hadInputBuffer: boolean }[] = []
  interface WorkerRequest {
    type: string
    batchId: number
    inputBuffer?: ArrayBuffer
  }
  class FakeWorker {
    onmessage: ((e: { data: unknown }) => void) | undefined = undefined
    postMessage(msg: WorkerRequest, transfer?: Transferable[]) {
      if (msg.type === 'init') {
        queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }))
        return
      }
      posted.push({ hadInputBuffer: msg.inputBuffer !== undefined })
      // a transferred buffer must actually be listed for transfer
      if (msg.inputBuffer !== undefined) {
        expect(transfer).toContain(msg.inputBuffer)
      }
      const input = new Uint8Array(msg.inputBuffer!)
      void Promise.resolve(decompressAll(input)).then(
        (data: Uint8Array) => {
          this.onmessage?.({
            data: {
              type: 'rangeResult',
              batchId: msg.batchId,
              data,
              viewMs: 0,
              wasmMs: 0,
            },
          })
        },
        (error: unknown) => {
          this.onmessage?.({
            data: {
              type: 'error',
              batchId: msg.batchId,
              message: String(error),
            },
          })
        },
      )
    }
    terminate() {
      this.onmessage = undefined
    }
  }
  // node supplies real Blob and URL.createObjectURL, so only Worker is missing
  vi.stubGlobal('Worker', FakeWorker)
  return posted
}

test('pool takes the transferable path and leaves the caller its bytes', async () => {
  const posted = installFakeWorker()

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
