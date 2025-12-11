import init, {
  decompress_block,
  decompress_all,
  decompress_chunk_slice,
  type DecompressResult,
  type ChunkSliceResult,
} from './bgzf_wasm.js'

let initialized = false
let initPromise: Promise<void> | null = null

async function ensureInit() {
  if (initialized) {
    return
  }
  if (!initPromise) {
    // @ts-expect-error
    initPromise = init().then(() => {
      initialized = true
    })
  }
  await initPromise
}

export interface BlockResult {
  data: Uint8Array
  bytesRead: number
}

export async function decompressBlock(
  input: Uint8Array,
  offset = 0,
): Promise<BlockResult> {
  await ensureInit()
  const subarray = offset > 0 ? input.subarray(offset) : input
  const result: DecompressResult = decompress_block(subarray)
  const data = result.data
  const bytesRead = result.bytes_read
  result.free()
  return { data, bytesRead }
}

export async function decompressAll(input: Uint8Array): Promise<Uint8Array> {
  await ensureInit()
  return decompress_all(input)
}

export interface ChunkSliceResultJS {
  buffer: Uint8Array
  cpositions: number[]
  dpositions: number[]
}

export async function decompressChunkSlice(
  input: Uint8Array,
  minBlockPosition: number,
  minDataPosition: number,
  maxBlockPosition: number,
  maxDataPosition: number,
): Promise<ChunkSliceResultJS> {
  await ensureInit()
  const result: ChunkSliceResult = decompress_chunk_slice(
    input,
    minBlockPosition,
    minDataPosition,
    maxBlockPosition,
    maxDataPosition,
  )
  const buffer = result.buffer
  const cpositions = [...result.cpositions]
  const dpositions = [...result.dpositions]
  result.free()
  return { buffer, cpositions, dpositions }
}
