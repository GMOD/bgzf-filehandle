import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

import { expect, test, vi } from 'vitest'

import { unzip } from '../src/unzip.ts'
import * as wasm from '../src/wasm/bgzf-wasm-inlined.js'

// Handing a non-bgzf input to wasm copies the whole thing into the wasm heap
// before the header check rejects it — and that heap never shrinks. Consumers
// call unzip() on arbitrary .gz files, so a plain gzip must never get there.
test('plain gzip input never reaches wasm', async () => {
  const spy = vi.spyOn(wasm, 'decompressAll')
  const text = 'a plain gzip file, not bgzf\n'.repeat(1000)
  const plain = new Uint8Array(gzipSync(Buffer.from(text)))

  const out = await unzip(plain)
  expect(new TextDecoder().decode(out)).toBe(text)
  expect(spy).not.toHaveBeenCalled()
  spy.mockRestore()
})

test('bgzf input still goes through wasm', async () => {
  const spy = vi.spyOn(wasm, 'decompressAll')
  const bgzf = new Uint8Array(
    readFileSync(require.resolve('./data/bgzip-1.txt.gz')),
  )

  await unzip(bgzf)
  expect(spy).toHaveBeenCalled()
  spy.mockRestore()
})

test('non-gzip input is rejected without touching wasm', async () => {
  const spy = vi.spyOn(wasm, 'decompressAll')
  await expect(unzip(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow(
    /not a valid bgzf or gzip block/,
  )
  expect(spy).not.toHaveBeenCalled()
  spy.mockRestore()
})

test('empty input decompresses to empty rather than throwing', async () => {
  expect(await unzip(new Uint8Array(0))).toEqual(new Uint8Array(0))
})
