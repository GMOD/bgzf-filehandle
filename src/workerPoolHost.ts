import type { BgzfBlockInfo } from './bgzfBlockScan.ts'
import type { BgzfWorkerPool, DecompressResult } from './workerPool.ts'

interface HostRequest {
  type: 'decompressBlocks'
  requestId: number
  sharedInput: SharedArrayBuffer
  blocks: BgzfBlockInfo[]
}

interface HostResponse {
  type: 'decompressResult' | 'error'
  requestId: number
  blockData?: Uint8Array[]
  transfer?: Transferable[]
  message?: string
}

export class BgzfWorkerPoolHost {
  private pool: BgzfWorkerPool
  private ports = new Set<MessagePort>()

  constructor(pool: BgzfWorkerPool) {
    this.pool = pool
  }

  connectPort(port: MessagePort) {
    this.ports.add(port)
    port.onmessage = (e) => {
      this.handleRequest(port, e.data)
    }
    port.start()
  }

  disconnectPort(port: MessagePort) {
    this.ports.delete(port)
    port.close()
  }

  private async handleRequest(port: MessagePort, req: HostRequest) {
    if (req.type === 'decompressBlocks') {
      try {
        const result = await this.pool.decompressBlocks(
          req.sharedInput,
          req.blocks,
        )
        // Collect unique ArrayBuffers for transfer (blocks may share
        // a parent buffer via subarray, so deduplicate)
        const seen = new Set<ArrayBuffer>()
        const transfer: Transferable[] = []
        for (const block of result.blocks) {
          if (block.buffer instanceof ArrayBuffer && !seen.has(block.buffer)) {
            seen.add(block.buffer)
            transfer.push(block.buffer)
          }
        }
        const response: HostResponse = {
          type: 'decompressResult',
          requestId: req.requestId,
          blockData: result.blocks,
        }
        port.postMessage(response, transfer)
      } catch (e) {
        const response: HostResponse = {
          type: 'error',
          requestId: req.requestId,
          message: e instanceof Error ? e.message : String(e),
        }
        port.postMessage(response)
      }
    }
  }

  destroy() {
    for (const port of this.ports) {
      port.close()
    }
    this.ports.clear()
    this.pool.destroy()
  }
}

export function createPoolPort(host: BgzfWorkerPoolHost) {
  const channel = new MessageChannel()
  host.connectPort(channel.port1)
  return channel.port2
}
