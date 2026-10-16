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
