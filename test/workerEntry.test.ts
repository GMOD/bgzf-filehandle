import fs from 'node:fs'

import { expect, test } from 'vitest'

import { scanBgzfBlocks } from '../src/bgzfBlockScan.ts'
import { decompressAll } from '../src/wasm/bgzf-wasm-inlined.js'
import workerSource from '../src/wasm/bgzf-worker-source.ts'

interface Reply {
  type: string
  batchId?: number
  message?: string
  data?: Uint8Array
}

/**
 * Runs the worker bundle the package ships, with `globalThis` and
 * `WebAssembly` swapped for stand-ins, and returns a function that sends one
 * message and resolves to the reply.
 */
function startWorker(webAssembly: typeof WebAssembly = WebAssembly) {
  const replies: Reply[] = []
  const scope = {
    onmessage: undefined as
      ((e: { data: unknown }) => Promise<void>) | undefined,
    postMessage: (msg: Reply) => {
      replies.push(msg)
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('globalThis', 'WebAssembly', workerSource)(scope, webAssembly)
  return async (data: unknown) => {
    await scope.onmessage!({ data })
    return replies.shift()!
  }
}

function withInstantiate(
  instantiate: (
    bytes: BufferSource,
    imports: WebAssembly.Imports,
  ) => Promise<WebAssembly.WebAssemblyInstantiatedSource>,
) {
  return Object.create(WebAssembly, {
    instantiate: { value: instantiate },
  }) as typeof WebAssembly
}

function blocksOf(input: Uint8Array, count: number) {
  const blocks = scanBgzfBlocks(input, 0, input.length).slice(0, count)
  const last = blocks.at(-1)!
  return input.slice(0, last.inputOffset + last.compressedSize)
}

const input = blocksOf(
  new Uint8Array(fs.readFileSync(require.resolve('./data/paired.bam'))),
  3,
)

test('a booted worker inflates a range', async () => {
  const send = startWorker()
  expect(await send({ type: 'init' })).toEqual({ type: 'ready' })
  const reply = await send({
    type: 'decompressRange',
    batchId: 7,
    inputBuffer: input.slice().buffer,
  })
  expect(reply.type).toBe('rangeResult')
  expect(reply.batchId).toBe(7)
  expect(Buffer.from(reply.data!).equals(await decompressAll(input))).toBe(true)
})

test('a worker whose wasm fails to load says so instead of reporting ready', async () => {
  const send = startWorker(
    withInstantiate(() =>
      Promise.reject(new WebAssembly.CompileError('out of memory')),
    ),
  )
  const reply = await send({ type: 'init' })
  expect(reply).toMatchObject({ type: 'error', message: 'out of memory' })
  expect(reply.batchId).toBeUndefined()
})

test('a wasm trap is reported as the worker failing, not the batch', async () => {
  const send = startWorker(
    withInstantiate(async (bytes, imports) => {
      const { module, instance } = await WebAssembly.instantiate(bytes, imports)
      const exports = {
        ...instance.exports,
        decompress_all: () => {
          throw new WebAssembly.RuntimeError('unreachable')
        },
      }
      return { module, instance: { exports } }
    }),
  )
  await send({ type: 'init' })
  const reply = await send({
    type: 'decompressRange',
    batchId: 3,
    inputBuffer: input.slice().buffer,
  })
  expect(reply).toMatchObject({ type: 'error', message: 'unreachable' })
  expect(reply.batchId).toBeUndefined()
})

test('corrupt data is still reported against its batch', async () => {
  const send = startWorker()
  await send({ type: 'init' })
  const corrupt = input.slice()
  corrupt.fill(0xff, 18, 60)
  const reply = await send({
    type: 'decompressRange',
    batchId: 5,
    inputBuffer: corrupt.buffer,
  })
  expect(reply).toMatchObject({ type: 'error', batchId: 5 })
})
