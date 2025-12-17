/* tslint:disable */
/* eslint-disable */

export class ChunkSliceResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly cpositions: Uint32Array;
  readonly dpositions: Uint32Array;
  readonly buffer: Uint8Array;
}

export class DecompressResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly bytes_read: number;
  readonly data: Uint8Array;
}

export function decompress_all(input: Uint8Array): Uint8Array;

export function decompress_block(input: Uint8Array): DecompressResult;

export function decompress_chunk_slice(input: Uint8Array, min_block_position: number, min_data_position: number, max_block_position: number, max_data_position: number): ChunkSliceResult;
