// Import the WASM binary as base64 data URL
import wasmData from '../../src/wasm/bgzf_wasm_bg.wasm'
import * as bg from '../../src/wasm/bgzf_wasm_bg.js'

let wasm = null
let initPromise = null

async function init() {
  if (wasm) return wasm

  if (!initPromise) {
    initPromise = (async () => {
      // wasmData is a data URL from asset/inline
      const response = await fetch(wasmData)
      const bytes = await response.arrayBuffer()
      const { instance } = await WebAssembly.instantiate(bytes, {
        './bgzf_wasm_bg.js': bg,
      })
      wasm = instance.exports
      bg.__wbg_set_wasm(wasm)
      return wasm
    })()
  }

  return initPromise
}

export async function decompressAll(input) {
  if (!wasm) {
    await init()
  }
  return bg.decompress_all(input)
}

export async function decompressChunkSlice(
  input,
  minBlockPosition,
  minDataPosition,
  maxBlockPosition,
  maxDataPosition,
) {
  if (!wasm) {
    await init()
  }
  const result = bg.decompress_chunk_slice(
    input,
    minBlockPosition,
    minDataPosition,
    maxBlockPosition,
    maxDataPosition,
  )
  // The take_* accessors already copy out of the wasm heap — wasm-bindgen
  // emits `getArrayF64FromWasm0(...).slice()` — so the returned typed arrays
  // own their bytes and stay valid after free() and after the heap grows.
  // Spreading them into plain arrays was therefore a second copy of every
  // block offset, for consumers (tabix-js, bam-js) that only index them.
  const buffer = result.take_buffer()
  const cpositions = result.take_cpositions()
  const dpositions = result.take_dpositions()
  result.free()
  return { buffer, cpositions, dpositions }
}



