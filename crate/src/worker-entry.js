import * as bg from '../../src/wasm/bgzf_wasm_bg.js'

async function handleMessage(data) {
  if (data.type === 'init') {
    const instance = await WebAssembly.instantiate(data.wasmModule, {
      './bgzf_wasm_bg.js': bg,
    })
    bg.__wbg_set_wasm(instance.exports)
    return { type: 'ready' }
  }

  if (data.type === 'decompressRange') {
    const { batchId, sharedInput, inputOffset, inputLength } = data
    const t0 = performance.now()
    const input = new Uint8Array(sharedInput, inputOffset, inputLength)
    const t1 = performance.now()
    const decompressed = bg.decompress_all(input)
    const t2 = performance.now()
    return {
      type: 'rangeResult',
      batchId,
      data: decompressed,
      viewMs: t1 - t0,
      wasmMs: t2 - t1,
      transfer: [decompressed.buffer],
    }
  }

  return { type: 'error', message: 'unknown message type' }
}

globalThis.onmessage = async (e) => {
  const result = await handleMessage(e.data)
  const transfer = result.transfer
  delete result.transfer
  if (transfer) {
    globalThis.postMessage(result, transfer)
  } else {
    globalThis.postMessage(result)
  }
}
