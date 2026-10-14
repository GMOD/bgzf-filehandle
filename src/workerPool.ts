import { inflateHere, splitBlocks } from './inflateBlocks.ts'
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
 * The worker failed, not the data: it raised an `error` event, sent a reply
 * this thread could not deserialize, or was terminated with a request still
 * out. A call that meets one inflates on the calling thread
 * instead. A decompression error a worker reports against one batch is about
 * the data, so it stays a plain `Error` and rejects the call.
 */
class WorkerFailure extends Error {}

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

// never hold a node process open on a timer; the browser's number has no unref
function unrefIfPossible(timer: unknown) {
  if (
    typeof timer === 'object' &&
    timer !== null &&
    'unref' in timer &&
    typeof timer.unref === 'function'
  ) {
    timer.unref()
  }
}

class ManagedWorker {
  private callbacks = new Map<number, RangeCallback>()
  private readyResolve!: () => void
  private readyReject!: (err: Error) => void
  private worker: Worker
  private nextBatchId = 0
  private dead = false
  private onFailure: (err: WorkerFailure) => void
  readyPromise: Promise<void>

  constructor(
    workerUrl: string | URL,
    onFailure: (err: WorkerFailure) => void,
  ) {
    this.onFailure = onFailure
    this.worker = new Worker(workerUrl)
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    this.readyPromise.catch(() => {
      // a worker that dies after booting rejects this with nobody awaiting it
    })
    this.worker.onmessage = e => {
      this.handleMessage(e.data)
    }
    // preventDefault, or the error reaches the enclosing scope: inside a data
    // worker that is its global onerror, which a host treats as that worker
    // dying and fails every call it has in flight
    this.worker.onerror = e => {
      e.preventDefault()
      this.fail(new WorkerFailure(`bgzf worker failed: ${e.message}`))
    }
    this.worker.onmessageerror = () => {
      this.fail(
        new WorkerFailure('a bgzf worker reply could not be deserialized'),
      )
    }
  }

  private handleMessage(msg: WorkerMessage) {
    if (msg.type === 'ready') {
      this.readyResolve()
    } else if (msg.type === 'rangeResult') {
      const cb = this.callbacks.get(msg.batchId)
      if (cb) {
        this.callbacks.delete(msg.batchId)
        cb.resolve({
          data: msg.data,
          timing: { viewMs: msg.viewMs, wasmMs: msg.wasmMs },
        })
      }
    } else if (msg.batchId === undefined) {
      this.fail(new WorkerFailure(msg.message ?? 'bgzf worker failed'))
    } else {
      const cb = this.callbacks.get(msg.batchId)
      if (cb) {
        this.callbacks.delete(msg.batchId)
        cb.reject(new Error(msg.message ?? 'worker decompression failed'))
      }
    }
  }

  private fail(err: WorkerFailure) {
    if (!this.dead) {
      this.terminate(err)
      this.onFailure(err)
    }
  }

  decompressRange(input: PoolInput, inputOffset: number, inputLength: number) {
    if (this.dead) {
      return Promise.reject(new WorkerFailure('bgzf worker was terminated'))
    }
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

  terminate(reason = new WorkerFailure('bgzf worker was terminated')) {
    if (this.dead) {
      return
    }
    this.dead = true
    this.worker.terminate()
    this.readyReject(reason)
    for (const [key, cb] of this.callbacks) {
      this.callbacks.delete(key)
      cb.reject(reason)
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
 */
export const DEFAULT_POOL_IDLE_TIMEOUT_MS = 3 * 60 * 1000

let sharedPool: BgzfWorkerPool | undefined

/**
 * One pool for this JS context, created on the first call and reused after
 * that. `numWorkers` and `idleTimeoutMs` apply only to the call that creates it.
 *
 * Resolves to undefined where workers cannot be launched at all (node, or a
 * host with no Blob URLs), so callers can pass the result straight to
 * `unzipChunkSlice` and get the sequential path. A browser without
 * cross-origin isolation is NOT such a host — it gets a working pool over the
 * transferable path.
 *
 * **Starts no workers.** They boot on the first call that reaches the pool,
 * which through `unzipChunkSlice` means the first chunk of at least
 * `POOL_MIN_DECOMPRESSED_BYTES`, so a reader that only ever asks for small
 * chunks never pays for them. Nothing waits on the boot either — see
 * {@link createBgzfWorkerPool}.
 */
export function getSharedWorkerPool(
  numWorkers?: number,
  idleTimeoutMs?: number,
): Promise<BgzfWorkerPool | undefined> {
  if (!sharedPool && workersAvailable()) {
    sharedPool = makePool(numWorkers, undefined, idleTimeoutMs).pool
  }
  return Promise.resolve(sharedPool)
}

export function destroySharedWorkerPool() {
  sharedPool?.destroy()
  sharedPool = undefined
}

/**
 * A pool of `numWorkers` workers you own, resolved once they are up, and
 * rejected if one of them fails to start. A worker the browser never starts
 * leaves it pending — Firefox queues one past `dom.workers.maxPerDomain`
 * without a word — so where that matters, use {@link getSharedWorkerPool},
 * which never waits.
 *
 * Past creation, **no call waits on a worker**: while the workers are booting,
 * or after the pool has given up on them, `decompressBlocks` inflates on the
 * calling thread and returns the same blocks. A worker failing mid-request
 * sends that request back to the calling thread too, and turns the pool off for
 * good — a worker that errors once is a pool that will error again, and the
 * calling thread is the path every consumer already runs without one.
 *
 * The pool **reaps its workers while idle** and spawns a fresh set on the next
 * call, invisibly to whoever holds it. Consumers keep a pool — `@gmod/bam`
 * stores the promise on the `BamFile` and awaits it once per chunk read, for
 * the life of the file — so the reclaiming cannot be `destroy()`: a destroyed
 * pool throws out of `decompressBlocks`. What the reap reclaims is mostly
 * memory: each worker holds its own wasm heap, and that `WebAssembly.Memory`
 * only ever grows. Pass `idleTimeoutMs: 0` to keep the workers up for the
 * pool's lifetime.
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
  const { pool, boot } = makePool(numWorkers, workerUrl, idleTimeoutMs)
  try {
    await boot()
  } catch (e) {
    pool.destroy()
    throw e
  }
  return pool
}

function makePool(
  numWorkers: number | undefined,
  workerUrl: string | URL | undefined,
  idleTimeoutMs: number = DEFAULT_POOL_IDLE_TIMEOUT_MS,
) {
  const count = numWorkers ?? Math.min(navigator.hardwareConcurrency, 4)
  let workers: ManagedWorker[] = []
  let destroyed = false
  let gaveUp = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let inFlight = 0
  let booting: Promise<void> | undefined

  function giveUp() {
    gaveUp = true
    clearIdle()
    for (const w of workers) {
      w.terminate()
    }
    workers = []
  }

  async function spawn() {
    const url = workerUrl ?? getWorkerBlobUrl()
    const started = Array.from(
      { length: count },
      () => new ManagedWorker(url, giveUp),
    )
    for (const w of started) {
      w.init()
    }
    // No deadline, deliberately. Nothing waits on this but createBgzfWorkerPool,
    // and a deadline would have to terminate the workers it gave up on: Firefox
    // freezes the page when terminating a running worker lets it start one it
    // had queued past `dom.workers.maxPerDomain`, which is the very state a
    // worker that never comes up is most often in. Left alone, a queued worker
    // that starts later is adopted then.
    try {
      await Promise.all(started.map(w => w.readyPromise))
    } catch (e) {
      for (const w of started) {
        w.terminate()
      }
      throw e
    }
    // destroy() may have landed while these were booting; do not adopt them
    if (destroyed || gaveUp) {
      for (const w of started) {
        w.terminate()
      }
      return
    }
    workers = started
    armIdle()
  }

  // one boot shared by every concurrent caller, or two queries arriving
  // together after a reap would each start a full set
  function boot() {
    booting ??= spawn()
      .catch((e: unknown) => {
        giveUp()
        throw e
      })
      .finally(() => {
        booting = undefined
      })
    return booting
  }

  function clearIdle() {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer)
      idleTimer = undefined
    }
  }

  // `terminate()` rejects a worker's pending callbacks, so reaping mid-request
  // would send a live query back to the calling thread rather than reclaim an
  // idle pool. The case is two OVERLAPPING requests — `decompressBlocks` clears
  // the timer on entry, so a single request in flight has no armed timer to go
  // wrong; it is the arming when the first settles, while the second is still
  // out, that would kill it. The check inside the callback is the load-bearing
  // one; the one here avoids arming a timer that would no-op.
  function armIdle() {
    clearIdle()
    if (
      destroyed ||
      idleTimeoutMs <= 0 ||
      inFlight > 0 ||
      workers.length === 0
    ) {
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
    unrefIfPossible(idleTimer)
  }

  const pool: BgzfWorkerPool = {
    async decompressBlocks(input, blocks) {
      if (destroyed) {
        throw new Error('Worker pool has been destroyed')
      }
      if (workers.length === 0) {
        if (!gaveUp) {
          boot().catch(() => {
            // giveUp has already turned the pool off; this call is inflating
            // here either way
          })
        }
        return inflateHere(input, blocks)
      }
      clearIdle()
      inFlight++
      try {
        return await run(workers, input, blocks)
      } catch (e) {
        if (e instanceof WorkerFailure) {
          return await inflateHere(input, blocks)
        }
        throw e
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

  return { pool, boot }
}

async function run(
  workers: ManagedWorker[],
  input: PoolInput,
  blocks: BgzfBlockInfo[],
): Promise<DecompressResult> {
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
    promises.push(workers[w]!.decompressRange(input, inputOffset, inputLength))
  }

  const rangeResults = await Promise.all(promises)
  const dispatchMs = performance.now() - dispatchStart

  const reassembleStart = performance.now()
  const resultBlocks = new Array<Uint8Array>(blocks.length)
  const workerTimings: WorkerTiming[] = []
  for (let r = 0; r < rangeInfos.length; r++) {
    const { startBlock, endBlock } = rangeInfos[r]!
    const { data, timing } = rangeResults[r]!
    workerTimings.push(timing)
    splitBlocks(data, blocks, startBlock, endBlock, resultBlocks)
  }
  const reassembleMs = performance.now() - reassembleStart

  return {
    blocks: resultBlocks,
    timing: { workerTimings, dispatchMs, reassembleMs },
  }
}
