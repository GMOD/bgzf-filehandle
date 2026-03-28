import * as bg from './bgzf_wasm_bg.js'

let wasmModule: WebAssembly.Module | undefined
let initPromise: Promise<void> | undefined

async function init() {
  const url = new URL('./bgzf_wasm_bg.wasm', import.meta.url)
  let module: WebAssembly.Module
  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const bytes = await readFile(fileURLToPath(url))
    module = await WebAssembly.compile(bytes)
  } else {
    module = await WebAssembly.compileStreaming(fetch(url))
  }
  const instance = await WebAssembly.instantiate(module, {
    './bgzf_wasm_bg.js': bg,
  })
  bg.__wbg_set_wasm(instance.exports)
  wasmModule = module
}

function ensureInit() {
  if (!initPromise) {
    initPromise = init()
  }
  return initPromise
}

export async function getCompiledWasmModule() {
  await ensureInit()
  return wasmModule!
}

export async function decompressAll(input: Uint8Array) {
  await ensureInit()
  return bg.decompress_all(input)
}

export async function decompressBlock(input: Uint8Array, offset = 0) {
  await ensureInit()
  const subarray = offset > 0 ? input.subarray(offset) : input
  const result = bg.decompress_block(subarray)
  const data = result.data
  const bytesRead = result.bytes_read
  result.free()
  return { data, bytesRead }
}

export async function decompressChunkSlice(
  input: Uint8Array,
  minBlockPosition: number,
  minDataPosition: number,
  maxBlockPosition: number,
  maxDataPosition: number,
) {
  await ensureInit()
  const result = bg.decompress_chunk_slice(
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
