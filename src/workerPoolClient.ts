import { inflateHere } from './inflateBlocks.ts'

import type { BgzfBlockInfo } from './bgzfBlockScan.ts'
import type {
  BgzfWorkerPool,
  DecompressResult,
  PoolInput,
} from './workerPool.ts'

type HostResponse =
  | { type: 'decompressResult'; requestId: number; blockData: Uint8Array[] }
  | { type: 'error'; requestId: number; message?: string }
  | { type: 'closed' }

interface PendingRequest {
  input: PoolInput
  blocks: BgzfBlockInfo[]
  resolve: (result: DecompressResult) => void
  reject: (err: Error) => void
}

/**
 * A pool on another thread, reached over a `MessagePort` from
 * {@link createPoolPort}. Once the host is gone, every call, including any
 * still waiting on it, inflates on this thread instead.
 */
export class BgzfWorkerPoolClient implements BgzfWorkerPool {
  private port: MessagePort
  private nextRequestId = 0
  private pending = new Map<number, PendingRequest>()
  private hostGone = false
  private destroyed = false

  constructor(port: MessagePort) {
    this.port = port
    this.port.onmessage = e => {
      this.handleResponse(e.data)
    }
    this.port.onmessageerror = () => {
      this.loseHost()
    }
    // raised only in Chrome and node
    this.port.addEventListener('close', () => {
      this.loseHost()
    })
    this.port.start()
  }

  private handleResponse(resp: HostResponse) {
    if (resp.type === 'closed') {
      this.loseHost()
      return
    }
    const req = this.pending.get(resp.requestId)
    if (req) {
      this.pending.delete(resp.requestId)
      if (resp.type === 'decompressResult') {
        req.resolve({ blocks: resp.blockData })
      } else {
        req.reject(new Error(resp.message ?? 'pool decompression failed'))
      }
    }
  }

  private loseHost() {
    if (this.hostGone) {
      return
    }
    this.hostGone = true
    this.port.close()
    for (const [key, req] of this.pending) {
      this.pending.delete(key)
      inflateHere(req.input, req.blocks).then(result => {
        if (this.destroyed) {
          req.reject(new Error('Client destroyed'))
        } else {
          req.resolve(result)
        }
      }, req.reject)
    }
  }

  async decompressBlocks(
    input: PoolInput,
    blocks: BgzfBlockInfo[],
  ): Promise<DecompressResult> {
    if (this.destroyed) {
      throw new Error('Client destroyed')
    }
    if (this.hostGone) {
      return inflateHere(input, blocks)
    }
    const requestId = this.nextRequestId++
    const promise = new Promise<DecompressResult>((resolve, reject) => {
      this.pending.set(requestId, { input, blocks, resolve, reject })
    })

    // One copy so the transfer detaches a buffer we own rather than the
    // caller's, then the host's pool slices per worker. That is a second pass
    // over the compressed bytes that the direct (non-port) pool does not pay —
    // the price of the hop, and still small against the inflate.
    const owned = new Uint8Array(input)
    this.port.postMessage(
      {
        type: 'decompressBlocks',
        requestId,
        inputBuffer: owned.buffer,
        blocks,
      },
      [owned.buffer],
    )

    return promise
  }

  destroy() {
    this.destroyed = true
    this.port.close()
    for (const [key, req] of this.pending) {
      this.pending.delete(key)
      req.reject(new Error('Client destroyed'))
    }
  }
}
