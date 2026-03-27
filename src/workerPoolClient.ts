import type { BgzfBlockInfo } from './bgzfBlockScan.ts'
import type { BgzfWorkerPool, DecompressResult } from './workerPool.ts'

type HostResponse =
  | { type: 'decompressResult'; requestId: number; blockData: Uint8Array[] }
  | { type: 'error'; requestId: number; message?: string }

interface PendingRequest {
  resolve: (blocks: Uint8Array[]) => void
  reject: (err: Error) => void
}

export class BgzfWorkerPoolClient implements BgzfWorkerPool {
  private port: MessagePort
  private nextRequestId = 0
  private pending = new Map<number, PendingRequest>()

  constructor(port: MessagePort) {
    this.port = port
    this.port.onmessage = (e) => {
      this.handleResponse(e.data)
    }
    this.port.start()
  }

  private handleResponse(resp: HostResponse) {
    const cb = this.pending.get(resp.requestId)
    if (cb) {
      this.pending.delete(resp.requestId)
      if (resp.type === 'decompressResult') {
        cb.resolve(resp.blockData)
      } else {
        cb.reject(new Error(resp.message ?? 'pool decompression failed'))
      }
    }
  }

  async decompressBlocks(
    sharedInput: SharedArrayBuffer,
    blocks: BgzfBlockInfo[],
  ): Promise<DecompressResult> {
    const requestId = this.nextRequestId++
    const promise = new Promise<Uint8Array[]>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
    })

    this.port.postMessage({
      type: 'decompressBlocks',
      requestId,
      sharedInput,
      blocks,
    })

    const resultBlocks = await promise
    return { blocks: resultBlocks }
  }

  destroy() {
    this.port.close()
    for (const [key, cb] of this.pending) {
      this.pending.delete(key)
      cb.reject(new Error('Client destroyed'))
    }
  }
}
