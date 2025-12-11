import init, {
  decompress_block,
  decompress_all,
  type DecompressResult,
} from './bgzf_wasm.js'

let initialized = false
let initPromise: Promise<void> | null = null

async function ensureInit() {
  if (initialized) {
    return
  }
  if (!initPromise) {
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
