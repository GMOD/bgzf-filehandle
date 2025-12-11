/* tslint:disable */
/* eslint-disable */

export class BlockInfo {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly compressed_size: number;
  readonly compressed_offset: number;
  readonly data: Uint8Array;
}

export class BlockResults {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  get(index: number): BlockInfo | undefined;
  readonly length: number;
}

export class DecompressResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly bytes_read: number;
  readonly data: Uint8Array;
}

/**
 * Decompress all gzip members from input, returning concatenated data.
 */
export function decompress_all(input: Uint8Array): Uint8Array;

/**
 * Decompress all blocks and return them separately with position info.
 */
export function decompress_all_blocks(input: Uint8Array): BlockResults;

/**
 * Decompress a single gzip member from the input buffer.
 * Returns the decompressed data and the number of bytes consumed from input.
 */
export function decompress_block(input: Uint8Array): DecompressResult;
