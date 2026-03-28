import type { BgzfBlockInfo } from './bgzfBlockScan.ts'
import type { BgzfWorkerPool } from './workerPool.ts'

interface HostRequest {
  type: string
  requestId: number
  sharedInput: SharedArrayBuffer
  blocks: BgzfBlockInfo[]
}

export class BgzfWorkerPoolHost {
  private pool: BgzfWorkerPool
  private ports = new Set<MessagePort>()

  constructor(pool: BgzfWorkerPool) {
    this.pool = pool
  }

  connectPort(port: MessagePort) {
    this.ports.add(port)
    port.onmessage = e => {
      void this.handleRequest(port, e.data)
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
        const seen = new Set<ArrayBuffer>()
        const transfer: Transferable[] = []
        for (const block of result.blocks) {
          if (block.buffer instanceof ArrayBuffer && !seen.has(block.buffer)) {
            seen.add(block.buffer)
            transfer.push(block.buffer)
          }
        }
        port.postMessage(
          {
            type: 'decompressResult',
            requestId: req.requestId,
            blockData: result.blocks,
          },
          transfer,
        )
      } catch (error) {
        port.postMessage({
          type: 'error',
          requestId: req.requestId,
          message: error instanceof Error ? error.message : String(error),
        })
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
