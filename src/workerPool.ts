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
 * Compressed bytes handed to the pool.
 *
 * Each worker's range is sliced out and **transferred** to it — a zero-copy
 * move, which every browser allows on any page.
 *
 * This deliberately does not accept a `SharedArrayBuffer`. That was the
 * original design and it was measured out: it requires the page to be
 * cross-origin isolated (COOP/COEP), which most JBrowse installs cannot set,
 * and it buys nothing when they can. Head to head in Chrome at 4 workers, a
 * pooled SAB was at parity with transferring and a freshly allocated one was
 * slower. The reason is structural — `decompressAll` copies its input into the
 * wasm heap either way, so shared memory removes the host-side slice and not
 * the boundary copy.
 */
export type PoolInput = Uint8Array

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
    // `slice`, not `subarray`: transferring detaches the buffer it is taken
    // from, and that buffer belongs to the caller — bam-js hands us the
    // filehandle read it is still holding. Copying this worker's range out
    // first keeps the transfer to bytes we own. One pass over the compressed
    // input, which is the smaller side of the operation.
    const piece = input.slice(inputOffset, inputOffset + inputLength)
    this.worker.postMessage(
      { type: 'decompressRange', batchId, inputBuffer: piece.buffer },
      [piece.buffer],
    )
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

/**
 * Terminate a pool's workers once nothing has asked it to inflate anything for
 * this long, and spawn a fresh set on the next call. Transparent to whoever
 * holds the pool — see {@link createBgzfWorkerPool}.
 *
 * Three minutes, matching the parsed-chunk caches in `@gmod/bam`, `@gmod/tabix`
 * and `@gmod/cram`, and for the same reason their ADRs give: the point is to
 * catch a reader who has walked away, not one who is looking at the screen in
 * front of them. A pan back a minute later should find the pool still up.
 *
 * It could afford to be shorter than those, since respawning costs a worker
 * boot and a wasm instantiate rather than a re-download — but there is no
 * measurement here to justify a different number, and matching the rest of the
 * stack is worth more than a tuned one that is not.
 */
export const DEFAULT_POOL_IDLE_TIMEOUT_MS = 3 * 60 * 1000

let sharedPool: BgzfWorkerPool | undefined
let sharedPoolPromise: Promise<BgzfWorkerPool | undefined> | undefined
let poolGeneration = 0

// Returns undefined where workers cannot be launched at all (node, or a host
// with no Blob URLs), so callers can pass the result straight to
// unzipChunkSlice and get the sequential fallback path. A browser without
// cross-origin isolation is NOT such a host — it gets a working pool over the
// transferable path.
//
// The pool this hands back reaps its own workers while idle and spawns them
// again on demand, so holding it for the life of a file — which is what
// `@gmod/bam` does — no longer pins four workers and their wasm heaps for the
// life of the page. See {@link createBgzfWorkerPool}; `idleTimeoutMs`, like
// `numWorkers`, only applies to the call that actually creates the pool.
export function getSharedWorkerPool(
  numWorkers?: number,
  idleTimeoutMs?: number,
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
      undefined,
      idleTimeoutMs,
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

/**
 * A pool of `numWorkers` workers, which **reaps them while idle** and spawns a
 * fresh set on the next call.
 *
 * The reap is invisible to whoever holds the pool, and that is the whole design
 * constraint rather than a nicety. Consumers keep a pool — `@gmod/bam` stores
 * the promise on the `BamFile` and awaits it once per chunk read, for the life
 * of the file — so the reclaiming cannot be `destroy()`: a destroyed pool
 * throws out of `decompressBlocks`, which would turn every open reader's next
 * read into an error rather than degrading it to inflating in process. Reaping
 * inside the pool keeps the object valid and only the workers come and go.
 *
 * What this reclaims is worth stating, because it is not mainly threads. Each
 * worker holds its own copy of the inlined wasm bundle, and that
 * `WebAssembly.Memory` only ever grows — so a pool that has inflated one deep
 * long-read chunk keeps that heap until the page goes away. Nothing else in
 * this library ever gave it back.
 *
 * Pass `idleTimeoutMs: 0` to keep the workers up for the pool's lifetime, which
 * is what every version before this did.
 */
export async function createBgzfWorkerPool(
  numWorkers?: number,
  workerUrl?: string | URL,
  idleTimeoutMs: number = DEFAULT_POOL_IDLE_TIMEOUT_MS,
): Promise<BgzfWorkerPool> {
  if (!workersAvailable()) {
    throw new Error(
      'cannot create a bgzf worker pool: this context has no Worker and Blob URL support',
    )
  }

  const url = workerUrl ?? getWorkerBlobUrl()
  const count = numWorkers ?? Math.min(navigator.hardwareConcurrency, 4)
  let workers: ManagedWorker[] = []
  let destroyed = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let inFlight = 0
  let spawning: Promise<void> | undefined

  async function spawn() {
    const started = Array.from({ length: count }, () => new ManagedWorker(url))
    for (const w of started) {
      w.init()
    }
    await Promise.all(started.map(w => w.readyPromise))
    // destroy() may have landed while these were booting; do not adopt them
    if (destroyed) {
      for (const w of started) {
        w.terminate()
      }
      return
    }
    workers = started
  }

  /** Workers, spawning them if an idle reap has taken them away. */
  async function ensureWorkers() {
    if (workers.length === 0) {
      // one spawn shared by every concurrent caller, or two queries arriving
      // together after a reap would each start a full set
      spawning ??= spawn().finally(() => {
        spawning = undefined
      })
      await spawning
    }
    return workers
  }

  function clearIdle() {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer)
      idleTimer = undefined
    }
  }

  // `terminate()` rejects a worker's pending callbacks, so reaping mid-request
  // fails a live query rather than reclaiming an idle pool. The case is two
  // OVERLAPPING requests — `decompressBlocks` clears the timer on entry, so a
  // single request in flight has no armed timer to go wrong; it is the arming
  // when the first settles, while the second is still out, that would kill it.
  //
  // The check inside the callback is the load-bearing one (verified by removing
  // each in turn: only dropping both fails the test). The one here just avoids
  // arming a timer that would no-op, which a multi-chunk query would otherwise
  // do once per chunk as each settles.
  function armIdle() {
    clearIdle()
    if (destroyed || idleTimeoutMs <= 0 || inFlight > 0) {
      return
    }
    idleTimer = setTimeout(() => {
      idleTimer = undefined
      if (inFlight > 0) {
        return
      }
      for (const w of workers) {
        w.terminate()
      }
      workers = []
    }, idleTimeoutMs)
    // never hold a node process open on this; the browser's number has no unref
    const timer: unknown = idleTimer
    if (
      typeof timer === 'object' &&
      timer !== null &&
      'unref' in timer &&
      typeof timer.unref === 'function'
    ) {
      timer.unref()
    }
  }

  await spawn()
  armIdle()

  return {
    async decompressBlocks(input, blocks) {
      if (destroyed) {
        throw new Error('Worker pool has been destroyed')
      }
      clearIdle()
      inFlight++
      try {
        return await run(input, blocks)
      } finally {
        inFlight--
        armIdle()
      }
    },

    destroy() {
      destroyed = true
      clearIdle()
      for (const w of workers) {
        w.terminate()
      }
      workers = []
    },
  }

  async function run(
    input: PoolInput,
    blocks: BgzfBlockInfo[],
  ): Promise<DecompressResult> {
    {
      const workers = await ensureWorkers()
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
    }
  }
}
