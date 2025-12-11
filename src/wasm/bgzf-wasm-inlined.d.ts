export interface BlockResult {
  data: Uint8Array
  bytesRead: number
}

export function decompressBlock(
  input: Uint8Array,
  offset?: number,
): Promise<BlockResult>

export function decompressAll(input: Uint8Array): Promise<Uint8Array>
