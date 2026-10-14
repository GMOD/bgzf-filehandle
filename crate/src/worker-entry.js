import { decompressAll, init } from './wrapper.js'

// A trap (a failed allocation under panic=abort) or a JS allocation failure is
// this worker failing, not the data. Replying without a batchId tells the pool
// so, and the pool inflates on the calling thread rather than rejecting.
function isWorkerFault(error) {
  return (
    error instanceof WebAssembly.RuntimeError || error instanceof RangeError
  )
}

async function handleMessage(data) {
  if (data.type === 'init') {
    await init()
    return { type: 'ready' }
  }

  if (data.type === 'decompressRange') {
    const { batchId, inputBuffer } = data
    const t0 = performance.now()
    const input = new Uint8Array(inputBuffer)
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

globalThis.onmessage = async e => {
  try {
    const { transfer, ...result } = await handleMessage(e.data)
    globalThis.postMessage(result, transfer ?? [])
  } catch (error) {
    globalThis.postMessage({
      type: 'error',
      batchId: isWorkerFault(error) ? undefined : e.data?.batchId,
      message: error?.message ?? String(error),
    })
  }
}
