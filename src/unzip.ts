import { ungzip } from 'pako-esm2'

import {
  decompressAll,
  decompressChunkSlice,
} from './wasm/bgzf-wasm-inlined.js'

interface VirtualOffset {
  blockPosition: number
  dataPosition: number
}
interface Chunk {
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

export async function unzip(inputData: Uint8Array) {
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

export async function unzipChunkSlice(inputData: Uint8Array, chunk: Chunk) {
  const { minv, maxv } = chunk
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
