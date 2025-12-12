import { ungzip } from 'pako-esm2'

import {
  decompressAll,
  decompressChunkSlice,
} from './wasm/bgzf-wasm-inlined.js'

// Type for the block cache (kept for API compatibility but not used in fast path)
export interface BlockCache {
  get(key: string): { buffer: Uint8Array; bytesRead: number } | undefined
  set(key: string, value: { buffer: Uint8Array; bytesRead: number }): void
}

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

async function decompressGzip(inputData: Uint8Array) {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip')
    const writer = ds.writable.getWriter()
    const writePromise = writer
      .write(inputData as Uint8Array<ArrayBuffer>)
      .then(() => writer.close())
    const chunks: Uint8Array[] = []
    const reader = ds.readable.getReader()
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      chunks.push(value)
    }
    await writePromise
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  } else {
    return ungzip(inputData, undefined)
  }
}

export async function unzip(inputData: Uint8Array) {
  try {
    return await decompressAll(inputData)
  } catch (e) {
    if (/invalid bgzf header/.exec(`${e}`)) {
      if (hasGzipHeader(inputData)) {
        return decompressGzip(inputData)
      }
      throw new Error(
        'problem decompressing block: not a valid bgzf or gzip block',
      )
    }
    if (/invalid gzip header/.exec(`${e}`)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw e
  }
}

export async function unzipChunkSlice(
  inputData: Uint8Array,
  chunk: Chunk,
  _blockCache?: BlockCache,
) {
  try {
    const { minv, maxv } = chunk
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
  } catch (e) {
    if (/invalid gzip header/.exec(`${e}`)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw e
  }
}
