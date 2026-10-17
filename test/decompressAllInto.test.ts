import fs from 'node:fs'

import { beforeEach, expect, test, vi } from 'vitest'

import { scanBgzfBlocks } from '../src/bgzfBlockScan.ts'
import { inflateRuns } from '../src/inflateBlocks.ts'
import { unzip } from '../src/unzip.ts'
import { decompressAll, init } from '../src/wasm/bgzf-wasm-inlined.js'

import type * as Wasm from '../src/wasm/bgzf-wasm-inlined.js'

const state = vi.hoisted(() => ({ hideRaw: false }))

vi.mock('../src/wasm/bgzf-wasm-inlined.js', async importOriginal => {
  const orig = await importOriginal<typeof Wasm>()
  return {
    ...orig,
    decompressAll: vi.fn(orig.decompressAll),
    init: async () => {
      const exports = await orig.init()
      return state.hideRaw ? { ...exports, decompress_all: undefined } : exports
    },
  }
})

const data = new Uint8Array(fs.readFileSync(require.resolve('./data/out.bam')))
const blocks = scanBgzfBlocks(data, 0, Infinity)
const runs = inflateRuns(blocks).length

async function stackPointer() {
  const exports = (await init()) as {
    __wbindgen_add_to_stack_pointer: (delta: number) => number
  }
  return exports.__wbindgen_add_to_stack_pointer(0)
}

async function oneCall(input: Uint8Array) {
  const out = await decompressAll(input)
  vi.mocked(decompressAll).mockClear()
  return Buffer.from(out)
}

beforeEach(() => {
  state.hideRaw = false
  vi.mocked(decompressAll).mockClear()
})

test('over the cap, unzip copies runs straight out of the wasm heap', async () => {
  expect(runs).toBeGreaterThan(1)
  const expected = await oneCall(data)
  const sp = await stackPointer()
  expect(Buffer.from(await unzip(data)).equals(expected)).toBe(true)
  expect(decompressAll).not.toHaveBeenCalled()
  expect(await stackPointer()).toBe(sp)
})

test('a bundle without the raw exports falls back to decompressAll', async () => {
  const expected = await oneCall(data)
  state.hideRaw = true
  expect(Buffer.from(await unzip(data)).equals(expected)).toBe(true)
  expect(decompressAll).toHaveBeenCalledTimes(runs)
})

test('a run that fails inflating throws the error decompressAll throws', async () => {
  const corrupt = data.slice()
  const bad = blocks[blocks.length - 5]!
  corrupt.fill(0xff, bad.inputOffset + 18, bad.inputOffset + 40)
  const expected = await decompressAll(corrupt).catch((e: unknown) => e)
  expect(expected).toBeInstanceOf(Error)
  vi.mocked(decompressAll).mockClear()

  const sp = await stackPointer()
  await expect(unzip(corrupt)).rejects.toThrow((expected as Error).message)
  expect(decompressAll).toHaveBeenCalledTimes(1)
  expect(await stackPointer()).toBe(sp)
  expect(Buffer.from(await unzip(data)).equals(await oneCall(data))).toBe(true)
})
