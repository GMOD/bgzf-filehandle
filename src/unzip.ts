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

function hasGzipHeader(data: Uint8Array) {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b
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

export async function unzip(inputData: Uint8Array) {
  try {
    return await decompressAll(inputData)
  } catch (error) {
    const message = errorMessage(error)
    if (message.includes('invalid bgzf header')) {
      if (hasGzipHeader(inputData)) {
        return decompressGzip(inputData)
      }
      throw new Error(
        'problem decompressing block: not a valid bgzf or gzip block',
        { cause: error },
      )
    }
    if (message.includes('invalid gzip header')) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
        { cause: error },
      )
    }
    throw error
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
    if (errorMessage(error).includes('invalid gzip header')) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
        { cause: error },
      )
    }
    throw error
  }
}
