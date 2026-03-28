import { ungzip } from 'pako-esm2'

import { type BgzfBlockInfo, scanBgzfBlocks } from './bgzfBlockScan.ts'
import { concatUint8Array } from './util.ts'
import {
  decompressAll,
  decompressChunkSlice,
} from './wasm/bgzf-wasm-inlined.js'
import type { BgzfWorkerPool } from './workerPool.ts'

export interface BlockCache {
  get(key: string): { buffer: Uint8Array; bytesRead: number } | undefined
  set(key: string, value: { buffer: Uint8Array; bytesRead: number }): void
}

export interface Filehandle {
  read(
    length: number,
    position: number,
    opts?: Record<string, unknown>,
  ): Promise<Uint8Array>
}

interface VirtualOffset {
  blockPosition: number
  dataPosition: number
}
interface Chunk {
  minv: VirtualOffset
  maxv: VirtualOffset
}

function hasGzipHeader(data: Uint8Array) {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b
}

async function decompressGzip(inputData: Uint8Array) {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip')
    const writer = ds.writable.getWriter()
    const writePromise = writer
      .write(inputData as Uint8Array<ArrayBuffer>)
      .then(() => writer.close())
    const chunks: Uint8Array[] = []
    const reader = ds.readable.getReader()
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      chunks.push(value)
    }
    await writePromise
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  } else {
    return ungzip(inputData, undefined)
  }
}

export async function unzip(inputData: Uint8Array) {
  try {
    return await decompressAll(inputData)
  } catch (error) {
    if (`${error}`.includes('invalid bgzf header')) {
      if (hasGzipHeader(inputData)) {
        return decompressGzip(inputData)
      }
      throw new Error(
        'problem decompressing block: not a valid bgzf or gzip block',
        { cause: error },
      )
    }
    if (`${error}`.includes('invalid gzip header')) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
        { cause: error },
      )
    }
    throw error
  }
}

function assembleChunkSliceResult(
  decompressedBlocks: Uint8Array[],
  blockInfos: BgzfBlockInfo[],
  minv: VirtualOffset,
  maxv: VirtualOffset,
) {
  const cpositions: number[] = []
  const dpositions: number[] = []
  const slices: Uint8Array[] = []
  let dpos = minv.dataPosition

  for (let i = 0; i < decompressedBlocks.length; i++) {
    const block = decompressedBlocks[i]!
    const info = blockInfos[i]!
    const isFirst = i === 0
    const isLast = info.filePosition >= maxv.blockPosition

    cpositions.push(info.filePosition)
    dpositions.push(dpos)

    const start = isFirst ? minv.dataPosition : 0
    const end = isLast
      ? Math.min(maxv.dataPosition + 1, block.length)
      : block.length

    if (start < end) {
      slices.push(block.subarray(start, end))
    }

    dpos += block.length - start

    if (isLast) {
      cpositions.push(info.filePosition + info.compressedSize)
      dpositions.push(dpos)
      break
    }
  }

  return {
    buffer: concatUint8Array(slices),
    cpositions,
    dpositions,
  }
}

export async function unzipChunkSlice(
  inputData: Uint8Array,
  chunk: Chunk,
  workerPool?: BgzfWorkerPool,
) {
  const { minv, maxv } = chunk

  if (workerPool) {
    const blocks = scanBgzfBlocks(
      inputData,
      minv.blockPosition,
      maxv.blockPosition,
    )

    if (blocks.length > 1) {
      let sharedBuf: SharedArrayBuffer
      if (
        inputData.buffer instanceof SharedArrayBuffer &&
        inputData.byteOffset === 0
      ) {
        sharedBuf = inputData.buffer
      } else {
        sharedBuf = new SharedArrayBuffer(inputData.byteLength)
        new Uint8Array(sharedBuf).set(inputData)
      }

      const decompressResult = await workerPool.decompressBlocks(
        sharedBuf,
        blocks,
      )
      return {
        ...assembleChunkSliceResult(
          decompressResult.blocks,
          blocks,
          minv,
          maxv,
        ),
        timing: decompressResult.timing,
      }
    }
  }

  try {
    const result = await decompressChunkSlice(
      inputData,
      minv.blockPosition,
      minv.dataPosition,
      maxv.blockPosition,
      maxv.dataPosition,
    )
    return {
      buffer: result.buffer,
      cpositions: result.cpositions,
      dpositions: result.dpositions,
    }
  } catch (error) {
    if (`${error}`.includes('invalid gzip header')) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
        { cause: error },
      )
    }
    throw error
  }
}
