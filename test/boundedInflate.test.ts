import fs from 'node:fs'

import { afterEach, expect, test, vi } from 'vitest'

import { installFakeWorker } from './fakeWorker.ts'
import { scanBgzfBlocks } from '../src/bgzfBlockScan.ts'
import {
  MAX_INFLATE_BYTES,
  inflateFootprint,
  inflateHere,
  inflateRuns,
} from '../src/inflateBlocks.ts'
import { unzip, unzipChunkSegments, unzipChunkSlice } from '../src/unzip.ts'
import { concatUint8Array } from '../src/util.ts'
import {
  decompressAll,
  decompressChunkSlice,
} from '../src/wasm/bgzf-wasm-inlined.js'
import { createBgzfWorkerPool } from '../src/workerPool.ts'

import type { Chunk } from '../src/unzip.ts'
import type { BgzfWorkerPool } from '../src/workerPool.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function load(name: string) {
  return new Uint8Array(fs.readFileSync(require.resolve(`./data/${name}`)))
}

const fixtures = [
  'shortreads_300x.bam',
  'out.bam',
  'chr22_nanopore_subset.bam',
  'ultra-long-ont.bam',
  'out.sorted.gff.gz',
].map(name => {
  const data = load(name)
  return { name, data, blocks: scanBgzfBlocks(data, 0, Infinity) }
})

function rng(seed: number) {
  let s = seed
  return (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s % n
  }
}

async function oneShot(input: Uint8Array, { minv, maxv }: Chunk) {
  return decompressChunkSlice(
    input,
    minv.blockPosition,
    minv.dataPosition,
    maxv.blockPosition,
    maxv.dataPosition,
  ) as Promise<{
    buffer: Uint8Array
    cpositions: Float64Array
    dpositions: Float64Array
  }>
}

async function expectSameAsOneShot(
  input: Uint8Array,
  chunk: Chunk,
  pool?: BgzfWorkerPool,
) {
  const expected = await oneShot(input, chunk)
  const slice = await unzipChunkSlice(input, chunk, pool)
  const segmented = await unzipChunkSegments(input, chunk, pool)
  const joined = concatUint8Array(segmented.segments)
  expect(Buffer.from(slice.buffer).equals(Buffer.from(expected.buffer))).toBe(
    true,
  )
  expect(Buffer.from(joined).equals(Buffer.from(expected.buffer))).toBe(true)
  for (const got of [slice, segmented]) {
    expect([...got.cpositions]).toEqual([...expected.cpositions])
    expect([...got.dpositions]).toEqual([...expected.dpositions])
  }
}

function randomChunk(
  blocks: ReturnType<typeof scanBgzfBlocks>,
  rand: (n: number) => number,
) {
  const first = rand(blocks.length)
  const last = first + rand(blocks.length - first)
  const start = blocks[first]!
  const chunk: Chunk = {
    minv: {
      blockPosition: start.filePosition,
      dataPosition: rand(start.decompressedSize + 1),
    },
    maxv: {
      blockPosition: blocks[last]!.filePosition,
      dataPosition: rand(65536),
    },
  }
  return { chunk, offset: start.inputOffset, first, last }
}

test('random chunks match the one-call wasm path', async () => {
  const rand = rng(1)
  let split = 0
  for (const { data, blocks } of fixtures) {
    for (let i = 0; i < 8; i++) {
      const { chunk, offset, first, last } = randomChunk(blocks, rand)
      if (inflateFootprint(blocks.slice(first, last + 1)) > MAX_INFLATE_BYTES) {
        split++
      }
      await expectSameAsOneShot(data.subarray(offset), chunk)
    }
  }
  expect(split).toBeGreaterThan(8)
}, 60_000)

test('random chunks through a pool whose worker ranges exceed the cap', async () => {
  installFakeWorker()
  const rand = rng(2)
  for (const workers of [1, 3]) {
    const pool = await createBgzfWorkerPool(workers)
    for (const { data, blocks } of fixtures) {
      for (let i = 0; i < 4; i++) {
        const { chunk, offset } = randomChunk(blocks, rand)
        await expectSameAsOneShot(data.subarray(offset), chunk, pool)
      }
    }
    pool.destroy()
  }
}, 60_000)

test('a chunk over the cap inflates into one buffer, not one per run', async () => {
  const { data, blocks } = fixtures[0]!
  const chunk: Chunk = {
    minv: { blockPosition: 0, dataPosition: 0 },
    maxv: { blockPosition: blocks.at(-1)!.filePosition, dataPosition: 65535 },
  }
  expect(inflateRuns(blocks).length).toBeGreaterThan(1)
  expect((await unzipChunkSegments(data, chunk)).segments).toHaveLength(1)
  const inflated = await inflateHere(data, blocks)
  expect(new Set(inflated.blocks.map(b => b.buffer)).size).toBe(1)
})

test('inflateRuns covers every block once, each run within the cap', () => {
  for (const { blocks } of fixtures) {
    const runs = inflateRuns(blocks)
    expect(runs[0]![0]).toBe(0)
    expect(runs.at(-1)![1]).toBe(blocks.length)
    for (let r = 0; r < runs.length; r++) {
      const [start, end] = runs[r]!
      expect(end).toBeGreaterThan(start)
      expect(runs[r + 1]?.[0] ?? blocks.length).toBe(end)
      expect(inflateFootprint(blocks.slice(start, end))).toBeLessThanOrEqual(
        MAX_INFLATE_BYTES,
      )
    }
  }
})

test('unzip of a whole file over the cap matches one decompressAll', async () => {
  for (const { data, blocks } of fixtures) {
    expect(inflateFootprint(blocks)).toBeGreaterThan(MAX_INFLATE_BYTES)
    const expected = await decompressAll(data)
    expect(Buffer.from(await unzip(data)).equals(Buffer.from(expected))).toBe(
      true,
    )
  }
})

test('truncated input stops at the last whole block, as one call does', async () => {
  const { data, blocks } = fixtures[1]!
  const cut = blocks[200]!.inputOffset + 1000
  const truncated = data.subarray(0, cut)
  const expected = await decompressAll(truncated)
  const got = await unzip(truncated)
  expect(got.length).toBe(
    blocks.slice(0, 200).reduce((n, b) => n + b.decompressedSize, 0),
  )
  expect(Buffer.from(got).equals(Buffer.from(expected))).toBe(true)
  await expectSameAsOneShot(truncated, {
    minv: { blockPosition: 0, dataPosition: 10 },
    maxv: { blockPosition: blocks.at(-1)!.filePosition, dataPosition: 0 },
  })
})

test('an ISIZE over 64 KiB ends the scan there, as one call does', async () => {
  const { data, blocks } = fixtures[1]!
  const corrupt = data.slice()
  const bad = blocks[300]!
  const isizePos = bad.inputOffset + bad.compressedSize - 4
  new DataView(corrupt.buffer).setUint32(isizePos, 1 << 20, true)

  expect(scanBgzfBlocks(corrupt, 0, Infinity)).toHaveLength(300)
  const expected = await decompressAll(corrupt)
  expect(Buffer.from(await unzip(corrupt)).equals(Buffer.from(expected))).toBe(
    true,
  )
  await expectSameAsOneShot(corrupt, {
    minv: { blockPosition: 0, dataPosition: 0 },
    maxv: { blockPosition: blocks.at(-1)!.filePosition, dataPosition: 65535 },
  })
})
