import { ungzip } from 'pako-esm2'

import { scanBgzfBlocks } from './bgzfBlockScan.ts'
import { concatUint8Array } from './util.ts'
import {
  decompressAll,
  decompressChunkSlice,
} from './wasm/bgzf-wasm-inlined.js'

import type { BgzfBlockInfo } from './bgzfBlockScan.ts'
import type { BgzfWorkerPool } from './workerPool.ts'

/**
 * A position in the uncompressed data: which BGZF block (by its compressed
 * offset in the file), and how far into that block's decompressed bytes.
 */
export interface VirtualOffset {
  blockPosition: number
  dataPosition: number
}

/**
 * A range between two virtual offsets — what a BAI or TBI resolves a query to.
 * It covers a run of consecutive BGZF blocks and usually starts and ends
 * partway through the first and last of them.
 */
export interface Chunk {
  minv: VirtualOffset
  maxv: VirtualOffset
}

const BGZF_MIN_BLOCK_SIZE = 26

function hasGzipHeader(data: Uint8Array) {
  return data[0] === 0x1f && data[1] === 0x8b
}

// Mirrors the header check in the wasm `parse_block`: gzip magic, deflate
// method, FEXTRA flag, XLEN=6 and the 'BC' extra-subfield id. Checked here so
// non-bgzf input never reaches wasm — see the comment in unzip().
function hasBgzfHeader(data: Uint8Array) {
  return (
    data.length >= BGZF_MIN_BLOCK_SIZE &&
    hasGzipHeader(data) &&
    data[2] === 8 &&
    data[3] === 4 &&
    data[10] === 6 &&
    data[12] === 0x42 &&
    data[13] === 0x43
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : `${error}`
}

async function decompressGzip(inputData: Uint8Array) {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([inputData as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } else {
    return ungzip(inputData, undefined)
  }
}

function wrapGzipHeaderError(error: unknown) {
  if (errorMessage(error).includes('invalid gzip header')) {
    return new Error(
      'problem decompressing block: incorrect gzip header check',
      { cause: error },
    )
  }
  return error
}

// The return type is annotated rather than inferred. `decompressAll` comes from
// the inlined wasm bundle, which is untyped JS, so inference makes this
// `Promise<any>` — and that `any` is published in the .d.ts and flows straight
// into consumers (@gmod/bam's csi.ts reads .buffer/.byteOffset/.subarray off it
// completely unchecked). The Rust returns `Vec<u8>`, i.e. a Uint8Array.
export async function unzip(inputData: Uint8Array): Promise<Uint8Array> {
  // Reading past EOF yields an empty buffer; decompressing nothing is nothing
  // rather than an error.
  if (inputData.length === 0) {
    return new Uint8Array(0)
  }
  // Sniff the header in JS before handing off to wasm. Calling into wasm
  // copies the whole input into the wasm heap, and that heap can only grow —
  // so routing a plain (non-bgzf) gzip file through wasm just to have it
  // rejected would permanently reserve the file's full size.
  if (!hasBgzfHeader(inputData)) {
    if (hasGzipHeader(inputData)) {
      return decompressGzip(inputData)
    }
    throw new Error(
      'problem decompressing block: not a valid bgzf or gzip block',
    )
  }
  try {
    return await decompressAll(inputData)
  } catch (error) {
    // A valid-looking header that wasm still rejects means the first block is
    // truncated; the generic gzip path gives a better error for that.
    if (errorMessage(error).includes('invalid bgzf header')) {
      return decompressGzip(inputData)
    }
    throw wrapGzipHeaderError(error)
  }
}

/**
 * A decompressed BGZF chunk plus, per block it spans, that block's compressed
 * offset in the file (`cpositions`) and its uncompressed offset within the
 * chunk (`dpositions`). Together they let a caller turn a byte offset in
 * `buffer` back into a virtual file offset — see @gmod/tabix and @gmod/bam.
 *
 * Annotated rather than inferred, for the same reason as {@link unzip}: it is
 * derived from the untyped inlined-wasm bundle, and whatever tsc makes of that
 * is what gets published in the .d.ts.
 */
export interface ChunkSlice {
  buffer: Uint8Array
  cpositions: Float64Array
  dpositions: Float64Array
}

/**
 * Reassemble a chunk slice from independently decompressed blocks.
 *
 * Mirrors what `decompress_chunk_slice` does in wasm: trim the first block to
 * `minv.dataPosition` and the last to `maxv.dataPosition`, and record each
 * block's compressed offset and its uncompressed offset within the result.
 */
function assembleChunkSliceResult(
  blocks: Uint8Array[],
  infos: BgzfBlockInfo[],
  minv: VirtualOffset,
  maxv: VirtualOffset,
): ChunkSlice {
  const cpositions: number[] = []
  const dpositions: number[] = []
  const slices: Uint8Array[] = []
  let dpos = minv.dataPosition

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    const info = infos[i]!
    const isLast = info.filePosition >= maxv.blockPosition

    cpositions.push(info.filePosition)
    dpositions.push(dpos)

    const start = i === 0 ? minv.dataPosition : 0
    const end = isLast
      ? Math.min(maxv.dataPosition + 1, block.length)
      : block.length
    if (start < end) {
      slices.push(block.subarray(start, end))
    }
    dpos += block.length - start

    if (isLast) {
      cpositions.push(info.filePosition + info.compressedSize)
      dpositions.push(dpos)
      break
    }
  }

  return {
    buffer: concatUint8Array(slices),
    // Float64Array to match the wasm path's shape exactly — a caller must not
    // be able to tell which one produced its result
    cpositions: Float64Array.from(cpositions),
    dpositions: Float64Array.from(dpositions),
  }
}

export async function unzipChunkSlice(
  inputData: Uint8Array,
  chunk: Chunk,
  workerPool?: BgzfWorkerPool,
): Promise<ChunkSlice> {
  const { minv, maxv } = chunk

  if (workerPool) {
    const blocks = scanBgzfBlocks(
      inputData,
      minv.blockPosition,
      maxv.blockPosition,
    )
    // one block is not worth a round trip to a worker
    if (blocks.length > 1) {
      const result = await workerPool.decompressBlocks(inputData, blocks)
      return assembleChunkSliceResult(result.blocks, blocks, minv, maxv)
    }
  }

  try {
    const result = await decompressChunkSlice(
      inputData,
      minv.blockPosition,
      minv.dataPosition,
      maxv.blockPosition,
      maxv.dataPosition,
    )
    return {
      buffer: result.buffer,
      cpositions: result.cpositions,
      dpositions: result.dpositions,
    }
  } catch (error) {
    throw wrapGzipHeaderError(error)
  }
}
