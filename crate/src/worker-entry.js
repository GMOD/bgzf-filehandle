import { decompressBlock, decompressAll } from './wrapper.js'

async function handleMessage(data) {
  if (data.type === 'init') {
    try {
      await decompressBlock(new Uint8Array(0))
    } catch {
      // expected to fail on empty input, but WASM is now initialized
    }
    return { type: 'ready' }
  }

  if (data.type === 'decompressRange') {
    const { batchId, sharedInput, inputOffset, inputLength } = data
    const t0 = performance.now()
    const input = new Uint8Array(sharedInput, inputOffset, inputLength)
    const t1 = performance.now()
    const decompressed = await decompressAll(input)
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
