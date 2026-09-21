import fs from 'node:fs'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installFakeWorker } from './fakeWorker.ts'
import { scanBgzfBlocks } from '../src/bgzfBlockScan.ts'
import { POOL_MIN_DECOMPRESSED_BYTES, unzipChunkSlice } from '../src/unzip.ts'
import {
  createBgzfWorkerPool,
  destroySharedWorkerPool,
  getSharedWorkerPool,
} from '../src/workerPool.ts'

import type { Chunk } from '../src/unzip.ts'
import type { BgzfWorkerPool } from '../src/workerPool.ts'

beforeEach(() => {
  destroySharedWorkerPool()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  destroySharedWorkerPool()
})

function fixture() {
  return new Uint8Array(
    fs.readFileSync(require.resolve('./data/shortreads_300x.bam')),
  )
}

/** a chunk over the file's leading blocks, sized at least `minBytes` out */
function chunkOf(input: Uint8Array, minBytes: number): Chunk {
  const blocks = scanBgzfBlocks(input, 0, input.length)
  let total = 0
  let last = 0
  while (total < minBytes) {
    total += blocks[last]!.decompressedSize
    last++
  }
  return {
    minv: { blockPosition: 0, dataPosition: 0 },
    maxv: { blockPosition: blocks[last - 1]!.filePosition, dataPosition: 100 },
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

// toEqual walks a typed array element by element, seconds at this size
function expectSameBytes(actual: Uint8Array, expected: Uint8Array) {
  expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true)
}

async function expectSameAsSequential(
  input: Uint8Array,
  chunk: Chunk,
  pool: BgzfWorkerPool | undefined,
) {
  const expected = await unzipChunkSlice(input, chunk)
  const actual = await unzipChunkSlice(input, chunk, pool)
  expectSameBytes(actual.buffer, expected.buffer)
  expect([...actual.cpositions]).toEqual([...expected.cpositions])
  expect([...actual.dpositions]).toEqual([...expected.dpositions])
}

test('a shared pool boots no workers for chunks too small to use them', async () => {
  const { live, posted } = installFakeWorker()
  const input = fixture()
  const pool = await getSharedWorkerPool(2)
  expect(live.constructed).toBe(0)

  await expectSameAsSequential(input, chunkOf(input, 100_000), pool)
  expect(live.constructed).toBe(0)
  expect(posted).toHaveLength(0)
})

test('the first large chunk boots the workers without waiting on them', async () => {
  const { live, posted } = installFakeWorker()
  const input = fixture()
  const large = chunkOf(input, POOL_MIN_DECOMPRESSED_BYTES)
  const pool = await getSharedWorkerPool(2)

  await expectSameAsSequential(input, large, pool)
  expect(live.constructed).toBe(2)
  expect(posted).toHaveLength(0)

  await tick()
  await expectSameAsSequential(input, large, pool)
  expect(posted.length).toBeGreaterThan(0)
})

test('a worker that errors while booting turns the pool off, and no read waits on it', async () => {
  const { live, posted } = installFakeWorker('error')
  const input = fixture()
  const large = chunkOf(input, POOL_MIN_DECOMPRESSED_BYTES)
  const pool = await getSharedWorkerPool(2)

  await expectSameAsSequential(input, large, pool)
  await tick()
  expect(live).toEqual({ constructed: 2, terminated: 2 })

  // given up on for good: no second boot, and nothing sent to a worker
  await expectSameAsSequential(input, large, pool)
  await tick()
  expect(live.constructed).toBe(2)
  expect(posted).toHaveLength(0)
})

test('createBgzfWorkerPool rejects when a worker errors while booting', async () => {
  const { live } = installFakeWorker('error')
  await expect(createBgzfWorkerPool(2)).rejects.toThrow(/bgzf worker failed/)
  expect(live).toEqual({ constructed: 2, terminated: 2 })
})

test('workers the browser has queued cost no read anything, and are used once they start', async () => {
  const fake = installFakeWorker('never')
  const input = fixture()
  const large = chunkOf(input, POOL_MIN_DECOMPRESSED_BYTES)
  const pool = await getSharedWorkerPool(2)

  await expectSameAsSequential(input, large, pool)
  await tick()
  await expectSameAsSequential(input, large, pool)
  expect(fake.posted).toHaveLength(0)
  // nothing terminated: in Firefox, terminating a running worker while others
  // are queued freezes the page
  expect(fake.live).toEqual({ constructed: 2, terminated: 0 })

  fake.startQueued()
  await tick()
  await expectSameAsSequential(input, large, pool)
  expect(fake.posted.length).toBeGreaterThan(0)
})

test('a worker dying mid-request sends that request back to the calling thread', async () => {
  const fake = installFakeWorker()
  const input = fixture()
  const large = chunkOf(input, POOL_MIN_DECOMPRESSED_BYTES)
  const expected = await unzipChunkSlice(input, large)

  const pool = await createBgzfWorkerPool(2)
  fake.setDeferReplies(true)
  const inFlight = unzipChunkSlice(input, large, pool)
  await tick()
  expect(fake.heldCount()).toBe(2)

  // handled, so the error goes no further than the pool
  expect(fake.crash()).toBe(1)
  expectSameBytes((await inFlight).buffer, expected.buffer)
  expect(fake.live.terminated).toBe(2)

  const sent = fake.posted.length
  await expectSameAsSequential(input, large, pool)
  expect(fake.posted).toHaveLength(sent)
  pool.destroy()
})

test('a decompression error is about the data, so it still rejects', async () => {
  installFakeWorker()
  const input = fixture()
  const large = chunkOf(input, POOL_MIN_DECOMPRESSED_BYTES)
  const blocks = scanBgzfBlocks(input, 0, large.maxv.blockPosition)
  const corrupt = input.slice()
  // scribble over the deflate payload of the last block, leaving its header
  // intact so the scan still finds it
  const lastBlock = blocks.at(-1)!
  corrupt.fill(0xff, lastBlock.inputOffset + 18, lastBlock.inputOffset + 60)

  const pool = await createBgzfWorkerPool(2)
  await expect(pool.decompressBlocks(corrupt, blocks)).rejects.toThrow()
  // and the pool is still up for the next, sound, request
  await expectSameAsSequential(input, large, pool)
  pool.destroy()
})
