/* tslint:disable */
/* eslint-disable */

export class ChunkSliceResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly buffer: Uint8Array;
    readonly cpositions: Float64Array;
    readonly dpositions: Float64Array;
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

/**
 * Decompress a slice of BGZF data between two virtual offsets.
 * Position parameters use f64 to map to JS number, supporting files >4GB.
 * The input buffer should be a slice starting at min_block_position in the original file.
 * Positions are tracked as f64 to preserve precision for large files.
 */
export function decompress_chunk_slice(input: Uint8Array, min_block_position: number, min_data_position: number, max_block_position: number, max_data_position: number): ChunkSliceResult;
