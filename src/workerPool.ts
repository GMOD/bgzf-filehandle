import workerSource from './wasm/bgzf-worker-source.ts'

import type { BgzfBlockInfo } from './bgzfBlockScan.ts'

export interface DecompressResult {
  blocks: Uint8Array[]
  timing?: {
    workerTimings: WorkerTiming[]
    dispatchMs: number
    reassembleMs: number
  }
}

/**
 * Compressed bytes handed to the pool, in one of two forms.
 *
 * A `Uint8Array` is sliced per worker and each slice **transferred** — a
 * zero-copy move of the slice, which every browser allows. This is the default
 * because it needs nothing of the host page.
 *
 * A `SharedArrayBuffer` is read in place by every worker with no slice at all,
 * but only exists on a cross-origin-isolated page (COOP/COEP). It is worth
 * taking when the caller *already* holds one — see `unzipChunkSlice` — and is
 * not worth manufacturing: copying a `Uint8Array` into a fresh SAB to get here
 * measured slower than transferring, because `decompressAll` copies the input
 * into the wasm heap either way. What SAB removes is the host-side slice, not
 * the wasm boundary copy.
 */
export type PoolInput = Uint8Array | SharedArrayBuffer

function isShared(input: PoolInput): input is SharedArrayBuffer {
  return (
    typeof SharedArrayBuffer !== 'undefined' &&
    input instanceof SharedArrayBuffer
  )
}

export interface BgzfWorkerPool {
  decompressBlocks(
    input: PoolInput,
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
  | { type: 'error'; batchId?: number; message?: string }

interface RangeResult {
  data: Uint8Array
  timing: WorkerTiming
}

interface RangeCallback {
  resolve: (result: RangeResult) => void
  reject: (err: Error) => void
}

/**
 * Whether this context can host the pool at all.
 *
 * This used to test for `SharedArrayBuffer`, which made the whole feature
 * conditional on cross-origin isolation. The transferable path needs no such
 * thing, so the real requirement is a Worker and a Blob URL to launch it from
 * — absent under node/vitest, which is what keeps `getSharedWorkerPool`
 * returning undefined there rather than throwing.
 */
function workersAvailable() {
  return (
    typeof Worker !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  )
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
      if (msg.batchId !== undefined) {
        const cb = this.callbacks.get(msg.batchId)
        if (cb) {
          this.callbacks.delete(msg.batchId)
          cb.reject(err)
        }
      } else {
        // No batchId — error wasn't tied to a specific request (e.g. the
        // worker died mid-init). Fail every in-flight callback.
        for (const [key, cb] of this.callbacks) {
          this.callbacks.delete(key)
          cb.reject(err)
        }
      }
    }
  }

  decompressRange(input: PoolInput, inputOffset: number, inputLength: number) {
    const batchId = this.nextBatchId++
    const promise = new Promise<RangeResult>((resolve, reject) => {
      this.callbacks.set(batchId, { resolve, reject })
    })
    if (isShared(input)) {
      this.worker.postMessage({
        type: 'decompressRange',
        batchId,
        sharedInput: input,
        inputOffset,
        inputLength,
      })
    } else {
      // `slice`, not `subarray`: transferring detaches the buffer it is taken
      // from, and that buffer belongs to the caller — bam-js hands us the
      // filehandle read it is still holding. Copying this worker's range out
      // first keeps the transfer to bytes we own. One pass over the compressed
      // input, which is the smaller side of the operation.
      const piece = input.slice(inputOffset, inputOffset + inputLength)
      this.worker.postMessage(
        {
          type: 'decompressRange',
          batchId,
          inputBuffer: piece.buffer,
          inputOffset: 0,
          inputLength,
        },
        [piece.buffer],
      )
    }
    return promise
  }

  init() {
    this.worker.postMessage({ type: 'init' })
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
let sharedPoolPromise: Promise<BgzfWorkerPool | undefined> | undefined
let poolGeneration = 0

// Returns undefined where workers cannot be launched at all (node, or a host
// with no Blob URLs), so callers can pass the result straight to
// unzipChunkSlice and get the sequential fallback path. A browser without
// cross-origin isolation is NOT such a host — it gets a working pool over the
// transferable path.
export function getSharedWorkerPool(
  numWorkers?: number,
): Promise<BgzfWorkerPool | undefined> {
  if (sharedPool) {
    return Promise.resolve(sharedPool)
  }
  if (!workersAvailable()) {
    return Promise.resolve(undefined)
  }
  if (!sharedPoolPromise) {
    const gen = poolGeneration
    const promise: Promise<BgzfWorkerPool | undefined> = createBgzfWorkerPool(
      numWorkers,
    ).then(
      pool => {
        if (gen !== poolGeneration) {
          pool.destroy()
          throw new Error('Worker pool was destroyed during initialization')
        }
        sharedPool = pool
        return pool
      },
      (error: unknown) => {
        // Clear the cached rejected promise so a later call can retry.
        if (sharedPoolPromise === promise) {
          sharedPoolPromise = undefined
        }
        throw error
      },
    )
    sharedPoolPromise = promise
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
  if (!workersAvailable()) {
    throw new Error(
      'cannot create a bgzf worker pool: this context has no Worker and Blob URL support',
    )
  }

  const url = workerUrl ?? getWorkerBlobUrl()
  const count = numWorkers ?? Math.min(navigator.hardwareConcurrency, 4)
  const workers: ManagedWorker[] = []

  for (let i = 0; i < count; i++) {
    workers.push(new ManagedWorker(url))
  }

  for (const w of workers) {
    w.init()
  }
  await Promise.all(workers.map(w => w.readyPromise))

  let destroyed = false

  return {
    async decompressBlocks(input, blocks) {
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
          workers[w]!.decompressRange(input, inputOffset, inputLength),
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
