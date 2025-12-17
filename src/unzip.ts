import { ungzip } from 'pako-esm2'

import ByteCache from './byteCache.ts'
import {
  decompressAll,
  decompressBlock,
  decompressChunkSlice,
  parseBlockBoundaries,
} from './wasm/bgzf-wasm-inlined.js'

// Type for the block cache (kept for API compatibility but not used in fast path)
export interface BlockCache {
  get(key: string): { buffer: Uint8Array; bytesRead: number } | undefined
  set(key: string, value: { buffer: Uint8Array; bytesRead: number }): void
}

// Minimal filehandle interface needed for decompressChunkCached
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
  } catch (e) {
    if (/invalid bgzf header/.exec(`${e}`)) {
      if (hasGzipHeader(inputData)) {
        return decompressGzip(inputData)
      }
      throw new Error(
        'problem decompressing block: not a valid bgzf or gzip block',
      )
    }
    if (/invalid gzip header/.exec(`${e}`)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw e
  }
}

export async function unzipChunkSlice(
  inputData: Uint8Array,
  chunk: Chunk,
  _blockCache?: BlockCache,
) {
  try {
    const { minv, maxv } = chunk
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
  } catch (e) {
    if (/invalid gzip header/.exec(`${e}`)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw e
  }
}

export interface DecompressedBlock {
  blockPosition: number
  data: Uint8Array
  compressedSize: number
}

export interface BlockInfo {
  blockPosition: number
  compressedStart: number
  compressedEnd: number
}

export async function getBlockPositions(
  inputData: Uint8Array,
  minBlockPosition: number,
): Promise<BlockInfo[]> {
  const boundaries = await parseBlockBoundaries(inputData)
  const numBlocks = boundaries.length - 1

  if (numBlocks === 0) {
    return []
  }

  const blocks: BlockInfo[] = []

  for (let i = 0; i < numBlocks; i++) {
    const relativeStart = boundaries[i]!
    const relativeEnd = boundaries[i + 1]!
    const absoluteBlockPos = minBlockPosition + relativeStart

    blocks.push({
      blockPosition: absoluteBlockPos,
      compressedStart: relativeStart,
      compressedEnd: relativeEnd,
    })
  }

  return blocks
}

export async function decompressSingleBlock(
  inputData: Uint8Array,
  blockInfo: BlockInfo,
): Promise<DecompressedBlock> {
  const blockInput = inputData.subarray(
    blockInfo.compressedStart,
    blockInfo.compressedEnd,
  )
  const result = await decompressBlock(blockInput)

  return {
    blockPosition: blockInfo.blockPosition,
    data: result.data,
    compressedSize: blockInfo.compressedEnd - blockInfo.compressedStart,
  }
}

export interface ChunkDecompressResult {
  buffer: Uint8Array
  cpositions: number[]
  dpositions: number[]
}

interface ChunkLike {
  minv: VirtualOffset
  maxv: VirtualOffset
  fetchedSize(): number
}

/**
 * Decompress a chunk using a byte cache to skip already-decompressed blocks.
 * This reads compressed data from the filehandle, decompresses only uncached
 * blocks, caches them, and returns the concatenated decompressed data.
 */
export async function decompressChunkCached(
  filehandle: Filehandle,
  chunk: ChunkLike,
  cache: ByteCache,
  opts?: Record<string, unknown>,
): Promise<ChunkDecompressResult> {
  const { minv, maxv } = chunk

  // Read compressed data
  const compressedData = await filehandle.read(
    chunk.fetchedSize(),
    minv.blockPosition,
    opts,
  )

  // Get block boundaries
  const blockInfos = await getBlockPositions(compressedData, minv.blockPosition)

  // Filter to blocks within chunk range
  const relevantBlocks = blockInfos.filter(
    b => b.blockPosition <= maxv.blockPosition,
  )

  // Decompress blocks (using cache where possible)
  const decompressedBlocks: Uint8Array[] = []
  const cpositions: number[] = []
  const dpositions: number[] = []
  let totalDecompressedSize = 0

  for (const blockInfo of relevantBlocks) {
    let blockData = cache.get(blockInfo.blockPosition)

    if (!blockData) {
      const decompressed = await decompressSingleBlock(
        compressedData,
        blockInfo,
      )
      blockData = decompressed.data
      cache.set(blockInfo.blockPosition, blockData)
    }

    cpositions.push(blockInfo.blockPosition)
    dpositions.push(totalDecompressedSize)
    decompressedBlocks.push(blockData)
    totalDecompressedSize += blockData.length
  }

  // Concatenate all decompressed data
  const buffer = new Uint8Array(totalDecompressedSize)
  let bufferOffset = 0
  for (const block of decompressedBlocks) {
    buffer.set(block, bufferOffset)
    bufferOffset += block.length
  }

  return { buffer, cpositions, dpositions }
}
