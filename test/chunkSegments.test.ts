import fs from 'node:fs'

import { afterEach, expect, test, vi } from 'vitest'

import { installFakeWorker } from './fakeWorker.ts'
import { scanBgzfBlocks } from '../src/bgzfBlockScan.ts'
import {
  POOL_MIN_DECOMPRESSED_BYTES,
  unzipChunkSegments,
  unzipChunkSlice,
} from '../src/unzip.ts'
import { concatUint8Array } from '../src/util.ts'
import {
  createBgzfWorkerPool,
  destroySharedWorkerPool,
  getSharedWorkerPool,
} from '../src/workerPool.ts'

import type { Chunk } from '../src/unzip.ts'
import type { BgzfWorkerPool } from '../src/workerPool.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  destroySharedWorkerPool()
})

const input = new Uint8Array(
  fs.readFileSync(require.resolve('./data/shortreads_300x.bam')),
)
const blocks = scanBgzfBlocks(input, 0, input.length)

function chunkOver(count: number, minData: number, maxData: number): Chunk {
  return {
    minv: { blockPosition: 0, dataPosition: minData },
    maxv: {
      blockPosition: blocks[count - 1]!.filePosition,
      dataPosition: maxData,
    },
  }
}

async function expectSameAsSlice(chunk: Chunk, pool?: BgzfWorkerPool) {
  const slice = await unzipChunkSlice(input, chunk)
  const segmented = await unzipChunkSegments(input, chunk, pool)
  expect(
    Buffer.from(concatUint8Array(segmented.segments)).equals(
      Buffer.from(slice.buffer),
    ),
  ).toBe(true)
  expect([...segmented.cpositions]).toEqual([...slice.cpositions])
  expect([...segmented.dpositions]).toEqual([...slice.dpositions])
  return segmented
}

test('segments join to exactly what unzipChunkSlice returns', async () => {
  installFakeWorker()
  for (const workers of [1, 2, 3, 4]) {
    const pool = await createBgzfWorkerPool(workers)
    for (const count of [8, 9, 30, 64]) {
      for (const [minData, maxData] of [
        [0, 65535],
        [50, 100],
        [1000, 0],
      ] as const) {
        const { segments } = await expectSameAsSlice(
          chunkOver(count, minData, maxData),
          pool,
        )
        expect(segments.length).toBeLessThanOrEqual(workers)
      }
    }
    pool.destroy()
  }
})

test('each worker range is one segment, with no copy of its bytes', async () => {
  installFakeWorker()
  const pool = await createBgzfWorkerPool(4)
  const { segments } = await expectSameAsSlice(chunkOver(64, 0, 65535), pool)
  expect(segments).toHaveLength(4)
  expect(new Set(segments.map(s => s.buffer)).size).toBe(4)
  pool.destroy()
})

test('a chunk below the pool threshold, or no pool, is one segment', async () => {
  installFakeWorker()
  const pool = await createBgzfWorkerPool(4)
  const small = chunkOver(2, 0, 65535)
  expect(
    blocks[0]!.decompressedSize + blocks[1]!.decompressedSize,
  ).toBeLessThan(POOL_MIN_DECOMPRESSED_BYTES)
  expect((await expectSameAsSlice(small, pool)).segments).toHaveLength(1)
  expect(
    (await expectSameAsSlice(chunkOver(64, 0, 65535))).segments,
  ).toHaveLength(1)
  pool.destroy()
})

test('inflating on the calling thread while workers boot is one segment', async () => {
  installFakeWorker('never')
  const pool = await getSharedWorkerPool(4)
  const { segments } = await expectSameAsSlice(chunkOver(64, 50, 100), pool)
  expect(segments).toHaveLength(1)
})
