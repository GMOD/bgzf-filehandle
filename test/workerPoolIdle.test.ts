import fs from 'node:fs'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installFakeWorker } from './fakeWorker.ts'
import { scanBgzfBlocks } from '../src/bgzfBlockScan.ts'
import {
  createBgzfWorkerPool,
  destroySharedWorkerPool,
} from '../src/workerPool.ts'

// A pool reaps its workers while idle and spawns a fresh set on the next call,
// WITHOUT the pool object becoming invalid. That last part is the requirement:
// consumers hold a pool for the life of a file (@gmod/bam keeps the promise on
// the BamFile and awaits it per chunk read), so reclaiming via destroy() would
// turn their next read into a throw instead of reclaiming an idle pool.

beforeEach(() => {
  destroySharedWorkerPool()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  destroySharedWorkerPool()
})

function fixture() {
  const input = new Uint8Array(
    fs.readFileSync(require.resolve('./data/paired.bam')),
  )
  return { input, blocks: scanBgzfBlocks(input, 0, input.length) }
}

test('workers are reaped once the pool has been idle, and respawned on use', async () => {
  const { live } = installFakeWorker()
  const { input, blocks } = fixture()

  const pool = await createBgzfWorkerPool(2, undefined, 1000)
  expect(live).toEqual({ constructed: 2, terminated: 0 })

  await vi.advanceTimersByTimeAsync(1001)
  expect(live).toEqual({ constructed: 2, terminated: 2 })

  // the pool object is still usable — this is the whole point
  const result = await pool.decompressBlocks(input, blocks)
  expect(result.blocks.length).toBe(blocks.length)
  expect(live.constructed).toBe(4)

  pool.destroy()
})

test('a reaped pool returns the same bytes as one that was never reaped', async () => {
  installFakeWorker()
  const { input, blocks } = fixture()

  const pool = await createBgzfWorkerPool(2, undefined, 1000)
  const before = await pool.decompressBlocks(input, blocks)
  await vi.advanceTimersByTimeAsync(1001)
  const after = await pool.decompressBlocks(input, blocks)

  expect(after.blocks.length).toBe(before.blocks.length)
  for (const [i, block] of before.blocks.entries()) {
    expect(after.blocks[i]).toEqual(block)
  }
  pool.destroy()
})

test('one request settling does not reap a concurrent one out from under it', async () => {
  const fake = installFakeWorker()
  const { input, blocks } = fixture()

  const pool = await createBgzfWorkerPool(2, undefined, 1000)
  fake.setDeferReplies(true)

  // Two overlapping requests, and only the FIRST is allowed to settle. This is
  // the case the in-flight guard exists for, and the single-request version of
  // this test could not see it: `decompressBlocks` clears the timer on entry,
  // so with one request in flight there is no armed timer to go wrong. It is
  // the arming that happens when A settles, while B is still out, that would
  // terminate B's workers under it — and terminate() rejects their pending
  // callbacks, so B fails rather than merely slowing down.
  const a = pool.decompressBlocks(input, blocks)
  await vi.advanceTimersByTimeAsync(0)
  const b = pool.decompressBlocks(input, blocks)
  await vi.advanceTimersByTimeAsync(0)
  expect(fake.heldCount()).toBe(4)

  fake.releaseReplies(2)
  expect((await a).blocks.length).toBe(blocks.length)

  await vi.advanceTimersByTimeAsync(5000)
  expect(fake.live.terminated).toBe(0)

  fake.releaseReplies()
  expect((await b).blocks.length).toBe(blocks.length)

  // and the clock only starts once the last one has settled
  await vi.advanceTimersByTimeAsync(1001)
  expect(fake.live.terminated).toBe(2)
  pool.destroy()
})

test('idleTimeoutMs 0 keeps the workers up, which is the old behaviour', async () => {
  const { live } = installFakeWorker()

  const pool = await createBgzfWorkerPool(2, undefined, 0)
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

  expect(live).toEqual({ constructed: 2, terminated: 0 })
  pool.destroy()
})

test('destroy() still throws for later callers, and stops the idle timer', async () => {
  const { live } = installFakeWorker()
  const { input, blocks } = fixture()

  const pool = await createBgzfWorkerPool(2, undefined, 1000)
  pool.destroy()
  expect(live.terminated).toBe(2)

  await expect(pool.decompressBlocks(input, blocks)).rejects.toThrow(
    /destroyed/,
  )
  // a timer left armed past destroy would terminate an empty set, or worse a
  // set a later pool had spawned
  await vi.advanceTimersByTimeAsync(5000)
  expect(live).toEqual({ constructed: 2, terminated: 2 })
})

test('two queries arriving together after a reap share one respawn', async () => {
  const { live } = installFakeWorker()
  const { input, blocks } = fixture()

  const pool = await createBgzfWorkerPool(2, undefined, 1000)
  await vi.advanceTimersByTimeAsync(1001)
  expect(live.constructed).toBe(2)

  // without a shared spawn promise each of these starts its own full set, and
  // the second overwrites the first's workers — leaking two live ones
  const [a, b] = await Promise.all([
    pool.decompressBlocks(input, blocks),
    pool.decompressBlocks(input, blocks),
  ])

  expect(live.constructed).toBe(4)
  expect(a.blocks.length).toBe(blocks.length)
  expect(b.blocks.length).toBe(blocks.length)
  pool.destroy()
})
