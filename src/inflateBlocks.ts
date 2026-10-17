import { MAX_BGZF_BLOCK_SIZE } from './constants.ts'
import { decompressAll, init } from './wasm/bgzf-wasm-inlined.js'

import type { BgzfBlockInfo } from './bgzfBlockScan.ts'
import type { DecompressResult } from './workerPool.ts'

/**
 * The most compressed plus inflated bytes one wasm call holds. The module's
 * `WebAssembly.Memory` only grows, so whatever a single call needs stays
 * reserved for the life of the context; a larger inflate goes through as
 * several calls of at most this much each.
 */
export const MAX_INFLATE_BYTES = 8 * 1024 * 1024

export function inflateFootprint(blocks: BgzfBlockInfo[]) {
  let total = 0
  for (const block of blocks) {
    total += block.compressedSize + block.decompressedSize
  }
  return total
}

/**
 * `[start, end)` runs of consecutive blocks within `[start, end)`, each one
 * wasm call of at most {@link MAX_INFLATE_BYTES}.
 */
export function inflateRuns(
  blocks: BgzfBlockInfo[],
  start = 0,
  end = blocks.length,
) {
  const runs: [number, number][] = []
  let runStart = start
  let bytes = 0
  for (let b = start; b < end; b++) {
    const block = blocks[b]!
    const size = block.compressedSize + block.decompressedSize
    if (b > runStart && bytes + size > MAX_INFLATE_BYTES) {
      runs.push([runStart, b])
      runStart = b
      bytes = 0
    }
    bytes += size
  }
  if (runStart < end) {
    runs.push([runStart, end])
  }
  return runs
}

export function runInputRange(
  blocks: BgzfBlockInfo[],
  start: number,
  end: number,
) {
  const first = blocks[start]!
  const last = blocks[end - 1]!
  return {
    inputOffset: first.inputOffset,
    inputLength: last.inputOffset + last.compressedSize - first.inputOffset,
  }
}

/**
 * The prefix of `input` that holds the scanned blocks, so a one-call inflate
 * copies no bytes past the last block wasm would read. With no blocks, wasm
 * rejects the first header, which it reads within one maximum-size block.
 */
export function scannedInput(input: Uint8Array, blocks: BgzfBlockInfo[]) {
  const last = blocks.at(-1)
  return input.subarray(
    0,
    last ? last.inputOffset + last.compressedSize : MAX_BGZF_BLOCK_SIZE,
  )
}

interface RawWasm {
  memory: WebAssembly.Memory
  decompress_all: (retptr: number, ptr: number, len: number) => void
  __wbindgen_add_to_stack_pointer: (delta: number) => number
  __wbindgen_export: (ptr: number, len: number, align: number) => void
  __wbindgen_export2: (len: number, align: number) => number
}

const RAW_ARITY = {
  decompress_all: 3,
  __wbindgen_add_to_stack_pointer: 1,
  __wbindgen_export: 3,
  __wbindgen_export2: 2,
}

/**
 * The wasm-bindgen exports `decompress_all`'s glue calls, when this bundle has
 * them under the names and arities it was built with. A rebuild with another
 * wasm-bindgen can rename them; callers then take the glue path.
 */
export function rawWasm(exports: Record<string, unknown>) {
  const named = Object.entries(RAW_ARITY).every(([name, arity]) => {
    const fn = exports[name]
    return typeof fn === 'function' && fn.length === arity
  })
  return named && exports.memory instanceof WebAssembly.Memory
    ? (exports as unknown as RawWasm)
    : undefined
}

/**
 * `decompressAll(input)` written into `output` at `offset`, copied straight out
 * of the wasm heap rather than through the glue's `.slice()`. Returns the
 * inflated length.
 */
export async function decompressAllInto(
  input: Uint8Array,
  output: Uint8Array,
  offset: number,
) {
  const raw = rawWasm(await init())
  if (raw) {
    const retptr = raw.__wbindgen_add_to_stack_pointer(-16)
    try {
      const ptr = raw.__wbindgen_export2(input.length, 1) >>> 0
      new Uint8Array(raw.memory.buffer).set(input, ptr)
      raw.decompress_all(retptr, ptr, input.length)
      const ret = new DataView(raw.memory.buffer)
      if (ret.getInt32(retptr + 12, true) === 0) {
        const outPtr = ret.getUint32(retptr, true)
        const outLen = ret.getUint32(retptr + 4, true)
        output.set(new Uint8Array(raw.memory.buffer, outPtr, outLen), offset)
        raw.__wbindgen_export(outPtr, outLen, 1)
        return outLen
      }
    } finally {
      raw.__wbindgen_add_to_stack_pointer(16)
    }
  }
  const run = await decompressAll(input)
  output.set(run, offset)
  return run.length
}

export function splitBlocks(
  decompressed: Uint8Array,
  blocks: BgzfBlockInfo[],
  startBlock: number,
  endBlock: number,
  out: Uint8Array[],
) {
  let offset = 0
  for (let b = startBlock; b < endBlock; b++) {
    const blockSize = blocks[b]!.decompressedSize
    out[b] = decompressed.subarray(offset, offset + blockSize)
    offset += blockSize
  }
}

/** The same blocks a worker would return, inflated on the calling thread. */
export async function inflateHere(
  input: Uint8Array,
  blocks: BgzfBlockInfo[],
): Promise<DecompressResult> {
  const resultBlocks = new Array<Uint8Array>(blocks.length)
  for (const [start, end] of inflateRuns(blocks)) {
    const { inputOffset, inputLength } = runInputRange(blocks, start, end)
    const decompressed = await decompressAll(
      input.subarray(inputOffset, inputOffset + inputLength),
    )
    splitBlocks(decompressed, blocks, start, end, resultBlocks)
  }
  return { blocks: resultBlocks }
}

/** @internal The size of this context's wasm `Memory`, which never shrinks. */
export async function wasmMemoryBytes() {
  const exports = await init()
  return (exports.memory as WebAssembly.Memory).buffer.byteLength
}
