import { decompressAll } from './wasm/bgzf-wasm-inlined.js'

import type { BgzfBlockInfo } from './bgzfBlockScan.ts'
import type { DecompressResult } from './workerPool.ts'

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
  const first = blocks[0]
  const last = blocks.at(-1)
  const resultBlocks = new Array<Uint8Array>(blocks.length)
  if (first && last) {
    const decompressed = await decompressAll(
      input.subarray(first.inputOffset, last.inputOffset + last.compressedSize),
    )
    splitBlocks(decompressed, blocks, 0, blocks.length, resultBlocks)
  }
  return { blocks: resultBlocks }
}
