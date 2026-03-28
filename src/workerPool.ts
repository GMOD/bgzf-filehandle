import workerSource from './wasm/bgzf-worker-source.ts'
import { getCompiledWasmModule } from './wasm/loadWasm.ts'

import type { BgzfBlockInfo } from './bgzfBlockScan.ts'

export interface DecompressResult {
  blocks: Uint8Array[]
  timing?: {
    workerTimings: WorkerTiming[]
    dispatchMs: number
    reassembleMs: number
  }
}

export interface BgzfWorkerPool {
  decompressBlocks(
    sharedInput: SharedArrayBuffer,
    blocks: BgzfBlockInfo[],
  ): Promise<DecompressResult>
  destroy(): void
}

export interface WorkerTiming {
  viewMs: number
  wasmMs: number
}

type WorkerMessage =
  | { type: 'ready' }
  | {
      type: 'rangeResult'
      batchId: number
      data: Uint8Array
      viewMs: number
      wasmMs: number
    }
  | { type: 'error'; message?: string }

interface RangeResult {
  data: Uint8Array
  timing: WorkerTiming
}

interface RangeCallback {
  resolve: (result: RangeResult) => void
  reject: (err: Error) => void
}

function sharedArrayBufferAvailable() {
  return typeof SharedArrayBuffer !== 'undefined'
}

class ManagedWorker {
  private callbacks = new Map<number, RangeCallback>()
  private readyResolve?: () => void
  private worker: Worker
  private nextBatchId = 0
  readyPromise: Promise<void>

  constructor(workerUrl: string | URL) {
    this.worker = new Worker(workerUrl)
    this.readyPromise = new Promise<void>(resolve => {
      this.readyResolve = resolve
    })
    this.worker.onmessage = e => {
      this.handleMessage(e.data)
    }
  }

  private handleMessage(msg: WorkerMessage) {
    if (msg.type === 'ready') {
      if (this.readyResolve) {
        this.readyResolve()
        this.readyResolve = undefined
      }
    } else if (msg.type === 'rangeResult') {
      const cb = this.callbacks.get(msg.batchId)
      if (cb) {
        this.callbacks.delete(msg.batchId)
        cb.resolve({
          data: msg.data,
          timing: { viewMs: msg.viewMs, wasmMs: msg.wasmMs },
        })
      }
    } else {
      const err = new Error(msg.message ?? 'worker decompression failed')
      for (const [key, cb] of this.callbacks) {
        this.callbacks.delete(key)
        cb.reject(err)
      }
    }
  }

  decompressRange(
    sharedInput: SharedArrayBuffer,
    inputOffset: number,
    inputLength: number,
  ) {
    const batchId = this.nextBatchId++
    const promise = new Promise<RangeResult>((resolve, reject) => {
      this.callbacks.set(batchId, { resolve, reject })
    })
    this.worker.postMessage({
      type: 'decompressRange',
      batchId,
      sharedInput,
      inputOffset,
      inputLength,
    })
    return promise
  }

  init(wasmModule: WebAssembly.Module) {
    this.worker.postMessage({ type: 'init', wasmModule })
  }

  terminate() {
    this.worker.terminate()
    for (const [key, cb] of this.callbacks) {
      this.callbacks.delete(key)
      cb.reject(new Error('Worker terminated'))
    }
  }
}

let cachedBlobUrl: string | undefined

function getWorkerBlobUrl() {
  if (!cachedBlobUrl) {
    const blob = new Blob([workerSource], { type: 'application/javascript' })
    cachedBlobUrl = URL.createObjectURL(blob)
  }
  return cachedBlobUrl
}

let sharedPool: BgzfWorkerPool | undefined
let sharedPoolPromise: Promise<BgzfWorkerPool> | undefined
let poolGeneration = 0

export function getSharedWorkerPool(
  numWorkers?: number,
): Promise<BgzfWorkerPool> {
  if (sharedPool) {
    return Promise.resolve(sharedPool)
  }
  if (!sharedPoolPromise) {
    const gen = poolGeneration
    sharedPoolPromise = createBgzfWorkerPool(numWorkers).then(pool => {
      if (gen !== poolGeneration) {
        pool.destroy()
        throw new Error('Worker pool was destroyed during initialization')
      }
      sharedPool = pool
      return pool
    })
  }
  return sharedPoolPromise
}

export function destroySharedWorkerPool() {
  poolGeneration++
  sharedPool?.destroy()
  sharedPool = undefined
  sharedPoolPromise = undefined
}

export async function createBgzfWorkerPool(
  numWorkers?: number,
  workerUrl?: string | URL,
): Promise<BgzfWorkerPool> {
  if (!sharedArrayBufferAvailable()) {
    throw new Error(
      'SharedArrayBuffer is not available. In browsers, set Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp headers.',
    )
  }

  const url = workerUrl ?? getWorkerBlobUrl()
  const count = numWorkers ?? Math.min(navigator.hardwareConcurrency, 4)
  const workers: ManagedWorker[] = []

  for (let i = 0; i < count; i++) {
    workers.push(new ManagedWorker(url))
  }

  const wasmModule = await getCompiledWasmModule()
  for (const w of workers) {
    w.init(wasmModule)
  }
  await Promise.all(workers.map(w => w.readyPromise))

  let destroyed = false

  return {
    async decompressBlocks(sharedInput, blocks) {
      if (destroyed) {
        throw new Error('Worker pool has been destroyed')
      }

      const numW = workers.length
      const blocksPerWorker = Math.ceil(blocks.length / numW)

      const rangeInfos: { startBlock: number; endBlock: number }[] = []
      const promises: Promise<RangeResult>[] = []

      const dispatchStart = performance.now()
      for (let w = 0; w < numW; w++) {
        const startBlock = w * blocksPerWorker
        const endBlock = Math.min(startBlock + blocksPerWorker, blocks.length)
        if (startBlock >= endBlock) {
          continue
        }

        const firstBlock = blocks[startBlock]!
        const lastBlock = blocks[endBlock - 1]!
        const inputOffset = firstBlock.inputOffset
        const inputLength =
          lastBlock.inputOffset + lastBlock.compressedSize - inputOffset

        rangeInfos.push({ startBlock, endBlock })
        promises.push(
          workers[w]!.decompressRange(sharedInput, inputOffset, inputLength),
        )
      }

      const rangeResults = await Promise.all(promises)
      const dispatchMs = performance.now() - dispatchStart

      const reassembleStart = performance.now()
      const resultBlocks = new Array<Uint8Array>(blocks.length)
      const workerTimings: WorkerTiming[] = []
      for (let r = 0; r < rangeInfos.length; r++) {
        const { startBlock, endBlock } = rangeInfos[r]!
        const { data: decompressed, timing } = rangeResults[r]!
        workerTimings.push(timing)
        let offset = 0
        for (let b = startBlock; b < endBlock; b++) {
          const blockSize = blocks[b]!.decompressedSize
          resultBlocks[b] = decompressed.subarray(offset, offset + blockSize)
          offset += blockSize
        }
      }
      const reassembleMs = performance.now() - reassembleStart

      return {
        blocks: resultBlocks,
        timing: { workerTimings, dispatchMs, reassembleMs },
      }
    },

    destroy() {
      destroyed = true
      for (const w of workers) {
        w.terminate()
      }
      workers.length = 0
    },
  }
}
