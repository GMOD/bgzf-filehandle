import { expect, vi } from 'vitest'

import { decompressAll } from '../src/wasm/bgzf-wasm-inlined.js'

interface WorkerRequest {
  type: string
  batchId: number
  inputBuffer?: ArrayBuffer
}

export interface FakeWorkerHandle {
  /** one entry per decompressRange dispatched */
  posted: { hadInputBuffer: boolean }[]
  /** how many workers have been constructed and terminated over the run */
  live: { constructed: number; terminated: number }
  /**
   * Hold every reply until released, so a test can assert what happens while a
   * request is genuinely in flight. Off by default.
   */
  setDeferReplies: (defer: boolean) => void
  /**
   * Release the oldest `n` held replies, or all of them. Held replies are in
   * dispatch order, so with W workers the first W belong to the first request —
   * which is how a test settles one of two overlapping requests and leaves the
   * other genuinely in flight.
   */
  releaseReplies: (n?: number) => void
  /** how many replies are currently held */
  heldCount: () => number
}

/**
 * A stand-in for a real Worker that runs the same wasm on this thread.
 *
 * Lets the transferable protocol — the `inputBuffer` field, the transfer list,
 * and the caller's buffer surviving the call — be asserted in CI, where no
 * Worker exists. It deliberately does NOT emulate structured clone; the browser
 * suite covers what actually crosses a thread boundary.
 *
 * Shared by the fallback and idle-reap suites rather than copied into each: the
 * idle suite needs the same protocol plus construct/terminate counts, and two
 * fakes that drift apart would be two different protocols under test.
 */
export function installFakeWorker(): FakeWorkerHandle {
  const posted: { hadInputBuffer: boolean }[] = []
  const live = { constructed: 0, terminated: 0 }
  let defer = false
  const held: (() => void)[] = []

  class FakeWorker {
    onmessage: ((e: { data: unknown }) => void) | undefined = undefined

    constructor() {
      live.constructed++
    }

    postMessage(msg: WorkerRequest, transfer?: Transferable[]) {
      if (msg.type === 'init') {
        queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }))
        return
      }
      posted.push({ hadInputBuffer: msg.inputBuffer !== undefined })
      // a transferred buffer must actually be listed for transfer
      if (msg.inputBuffer !== undefined) {
        expect(transfer).toContain(msg.inputBuffer)
      }
      const input = new Uint8Array(msg.inputBuffer!)
      void Promise.resolve(decompressAll(input)).then(
        (data: Uint8Array) => {
          const reply = () => {
            this.onmessage?.({
              data: {
                type: 'rangeResult',
                batchId: msg.batchId,
                data,
                viewMs: 0,
                wasmMs: 0,
              },
            })
          }
          if (defer) {
            held.push(reply)
          } else {
            reply()
          }
        },
        (error: unknown) => {
          this.onmessage?.({
            data: {
              type: 'error',
              batchId: msg.batchId,
              message: String(error),
            },
          })
        },
      )
    }

    terminate() {
      live.terminated++
      this.onmessage = undefined
    }
  }

  // node supplies real Blob and URL.createObjectURL, so only Worker is missing
  vi.stubGlobal('Worker', FakeWorker)

  return {
    posted,
    live,
    setDeferReplies: (d: boolean) => {
      defer = d
    },
    releaseReplies: (n?: number) => {
      const pending = n === undefined ? held.splice(0) : held.splice(0, n)
      for (const reply of pending) {
        reply()
      }
    },
    heldCount: () => held.length,
  }
}
