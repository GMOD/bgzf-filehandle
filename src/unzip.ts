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

async function decompressGzip(inputData: Uint8Array) {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(inputData)
  writer.close()
  const result = await new Response(ds.readable).arrayBuffer()
  return new Uint8Array(result)
}

export async function unzip(inputData: Uint8Array) {
  try {
    return await decompressAll(inputData)
  } catch (e) {
    if (/invalid bgzf header/.exec(`${e}`)) {
      return decompressGzip(inputData)
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
