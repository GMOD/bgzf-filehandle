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
  try {
    const { transfer, ...result } = await handleMessage(e.data)
    globalThis.postMessage(result, transfer ?? [])
  } catch (error) {
    // Surface failures back to the host so the caller's promise rejects
    // instead of hanging forever.
    globalThis.postMessage({
      type: 'error',
      batchId: e.data && e.data.batchId,
      message: error && error.message ? error.message : String(error),
    })
  }
}
