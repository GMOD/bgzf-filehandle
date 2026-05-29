/* tslint:disable */
/* eslint-disable */

export class ChunkSliceResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    take_buffer(): Uint8Array;
    take_cpositions(): Float64Array;
    take_dpositions(): Float64Array;
}

export function decompress_all(input: Uint8Array): Uint8Array;

/**
 * Decompress a slice of BGZF data between two virtual offsets.
 * Position parameters use f64 to map to JS number, supporting files >4GB.
 * The input buffer should be a slice starting at min_block_position in the original file.
 * Positions are tracked as f64 to preserve precision for large files.
 */
export function decompress_chunk_slice(input: Uint8Array, min_block_position: number, min_data_position: number, max_block_position: number, max_data_position: number): ChunkSliceResult;
