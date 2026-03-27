import { BgzfWorkerPoolClient } from '/esm/workerPoolClient.js'
import { scanBgzfBlocks } from '/esm/bgzfBlockScan.js'
import { concatUint8Array } from '/esm/util.js'

let client

function assembleResult(decompressedBlocks, blockInfos, minv, maxv) {
  const cpositions = []
  const dpositions = []
  const slices = []
  let dpos = minv.dataPosition
  for (let i = 0; i < decompressedBlocks.length; i++) {
    const block = decompressedBlocks[i]
    const info = blockInfos[i]
    const isFirst = i === 0
    const isLast = info.filePosition >= maxv.blockPosition
    cpositions.push(info.filePosition)
    dpositions.push(dpos)
    const start = isFirst ? minv.dataPosition : 0
    const end = isLast ? Math.min(maxv.dataPosition + 1, block.length) : block.length
    if (start < end) {slices.push(block.subarray(start, end))}
    dpos += block.length - start
    if (isLast) {
      cpositions.push(info.filePosition + info.compressedSize)
      dpositions.push(dpos)
      break
    }
  }
  return { buffer: concatUint8Array(slices), cpositions, dpositions }
}

async function decompressViaPool(data, chunk, pool) {
  const { minv, maxv } = chunk
  const blocks = scanBgzfBlocks(data, minv.blockPosition, maxv.blockPosition)

  let sharedBuf
  if (data.buffer instanceof SharedArrayBuffer) {
    sharedBuf = data.buffer
  } else {
    sharedBuf = new SharedArrayBuffer(data.byteLength)
    new Uint8Array(sharedBuf).set(data)
  }
  const result = await pool.decompressBlocks(sharedBuf, blocks)
  return assembleResult(result.blocks, blocks, minv, maxv)
}

globalThis.onmessage = async (e) => {
  if (e.data.type === 'initPort') {
    client = new BgzfWorkerPoolClient(e.ports[0])
    globalThis.postMessage({ type: 'ready' })
    return
  }

  if (e.data.type === 'benchmark') {
    try {
      const { sharedData, iterations } = e.data
      const data = new Uint8Array(sharedData)
      const blocks = scanBgzfBlocks(data, 0, data.length)
      const lastBlock = blocks.at(-1)
      const chunk = {
        minv: { dataPosition: 0, blockPosition: 0 },
        maxv: { dataPosition: 65535, blockPosition: lastBlock.filePosition },
      }

      // Warmup
      await decompressViaPool(data, chunk, client)
      await decompressViaPool(data, chunk, client)

      const parStart = globalThis.performance.now()
      for (let i = 0; i < iterations; i++) {
        await decompressViaPool(data, chunk, client)
      }
      const parTime = globalThis.performance.now() - parStart

      globalThis.postMessage({ type: 'benchResult', parTime, blocks: blocks.length })
    } catch (error) {
      globalThis.postMessage({ type: 'error', message: error.message + '\n' + error.stack })
    }
  }
}
