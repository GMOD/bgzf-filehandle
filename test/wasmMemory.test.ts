import fs from 'node:fs'

import { expect, test } from 'vitest'

import { scanBgzfBlocks } from '../src/bgzfBlockScan.ts'
import { inflateFootprint, wasmMemoryBytes } from '../src/inflateBlocks.ts'
import { unzip, unzipChunkSegments, unzipChunkSlice } from '../src/unzip.ts'

const MiB = 2 ** 20

test('wasm memory stays near the cap after inflates many times its size', async () => {
  const data = new Uint8Array(
    fs.readFileSync(require.resolve('./data/out.bam')),
  )
  const blocks = scanBgzfBlocks(data, 0, Infinity)
  expect(inflateFootprint(blocks)).toBeGreaterThan(48 * MiB)
  const chunk = {
    minv: { blockPosition: 0, dataPosition: 0 },
    maxv: { blockPosition: blocks.at(-1)!.filePosition, dataPosition: 65535 },
  }

  await unzip(data)
  await unzipChunkSegments(data, chunk)
  await unzipChunkSlice(data, chunk)

  expect(await wasmMemoryBytes()).toBeLessThan(32 * MiB)
})
