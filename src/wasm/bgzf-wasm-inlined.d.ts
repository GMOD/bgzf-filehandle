export interface BlockResult {
  data: Uint8Array
  bytesRead: number
}

export interface ChunkSliceResult {
  buffer: Uint8Array
  cpositions: number[]
  dpositions: number[]
}

export function decompressBlock(
  input: Uint8Array,
  offset?: number,
): Promise<BlockResult>

export function decompressAll(input: Uint8Array): Promise<Uint8Array>

export function decompressChunkSlice(
  input: Uint8Array,
  minBlockPosition: number,
  minDataPosition: number,
  maxBlockPosition: number,
  maxDataPosition: number,
): Promise<ChunkSliceResult>
