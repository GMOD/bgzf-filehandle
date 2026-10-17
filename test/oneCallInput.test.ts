import fs from 'node:fs'

import { expect, test } from 'vitest'

import { scanBgzfBlocks } from '../src/bgzfBlockScan.ts'
import { wasmMemoryBytes } from '../src/inflateBlocks.ts'
import { unzip, unzipChunkSegments, unzipChunkSlice } from '../src/unzip.ts'
import { concatUint8Array } from '../src/util.ts'
import {
  decompressAll,
  decompressChunkSlice,
} from '../src/wasm/bgzf-wasm-inlined.js'

const MiB = 2 ** 20

test('a one-call inflate copies only the scanned blocks into wasm', async () => {
  const data = new Uint8Array(
    fs.readFileSync(require.resolve('./data/out.bam')),
  )
  const blocks = scanBgzfBlocks(data, 0, Infinity)
  const chunk = {
    minv: { blockPosition: 0, dataPosition: 0 },
    maxv: { blockPosition: blocks[1]!.filePosition, dataPosition: 100 },
  }
  const junk = new Uint8Array(64 * MiB)
  junk.set(data.subarray(0, blocks[0]!.compressedSize))

  const slice = await unzipChunkSlice(data, chunk)
  const segments = await unzipChunkSegments(data, chunk)
  const unzipped = await unzip(junk)
  expect(await wasmMemoryBytes()).toBeLessThan(8 * MiB)

  const expected = await decompressChunkSlice(
    data,
    chunk.minv.blockPosition,
    chunk.minv.dataPosition,
    chunk.maxv.blockPosition,
    chunk.maxv.dataPosition,
  )
  for (const got of [
    slice,
    { ...segments, buffer: concatUint8Array(segments.segments) },
  ]) {
    expect(Buffer.from(got.buffer).equals(Buffer.from(expected.buffer))).toBe(
      true,
    )
    expect([...got.cpositions]).toEqual([...expected.cpositions])
    expect([...got.dpositions]).toEqual([...expected.dpositions])
  }
  expect(
    Buffer.from(unzipped).equals(Buffer.from(await decompressAll(junk))),
  ).toBe(true)
})
