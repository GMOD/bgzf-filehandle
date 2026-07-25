use std::cell::RefCell;

use libdeflater::Decompressor;
use wasm_bindgen::prelude::*;

const BGZF_HEADER_SIZE: usize = 18;
const BGZF_TRAILER_SIZE: usize = 8;
const BGZF_MIN_BLOCK_SIZE: usize = BGZF_HEADER_SIZE + BGZF_TRAILER_SIZE;
// The BGZF spec caps a block's uncompressed payload at 65 536 bytes. Used to
// size the reusable scratch buffer and to reject corrupt ISIZE fields.
const BGZF_MAX_BLOCK_SIZE: usize = 1 << 16;

const ERR_BAD_HEADER: &str = "invalid bgzf header";
const ERR_INFLATE: &str = "decompression failed";

// libdeflate's decompressor is a ~100 KB heap struct, and the scratch buffer
// is one block's worth of output. Both were allocated per call (per *block*,
// for scratch) before; hoisting them out is worth a few percent and keeps the
// allocation count flat regardless of how many blocks a call spans. wasm is
// single-threaded and decompression is synchronous, so these are never
// contended.
thread_local! {
    static DECOMPRESSOR: RefCell<Decompressor> = RefCell::new(Decompressor::new());
    static SCRATCH: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn with_decompressor<T>(f: impl FnOnce(&mut Decompressor) -> T) -> T {
    DECOMPRESSOR.with(|d| f(&mut d.borrow_mut()))
}

/// `(compressed block size, uncompressed size)` for the BGZF block at the
/// start of `input`, or None if the header is malformed or the block is
/// truncated.
fn parse_block(input: &[u8]) -> Option<(usize, usize)> {
    // magic (1f 8b), method (08), flags (04), XLEN=6, SI1='B', SI2='C'
    if input.len() < BGZF_MIN_BLOCK_SIZE
        || input[0] != 0x1f
        || input[1] != 0x8b
        || input[2] != 8
        || input[3] != 4
        || input[10] != 6
        || input[12] != b'B'
        || input[13] != b'C'
    {
        return None;
    }

    let block_size = u16::from_le_bytes([input[16], input[17]]) as usize + 1;
    if block_size < BGZF_MIN_BLOCK_SIZE || input.len() < block_size {
        return None;
    }

    // ISIZE: last 4 bytes of the trailer. Reject anything over the spec limit
    // so a corrupt trailer can't drive a multi-GB allocation or overrun the
    // fixed-size scratch buffer.
    let trailer = block_size - BGZF_TRAILER_SIZE;
    let isize = u32::from_le_bytes([
        input[trailer + 4],
        input[trailer + 5],
        input[trailer + 6],
        input[trailer + 7],
    ]) as usize;
    if isize > BGZF_MAX_BLOCK_SIZE {
        return None;
    }
    Some((block_size, isize))
}

/// Total uncompressed size of every complete BGZF block in `input`, so callers
/// can allocate the output buffer exactly once. Stops at the first block whose
/// header/trailer doesn't fit, matching the decompress loops' handling of
/// truncated input.
fn total_uncompressed_size(input: &[u8]) -> usize {
    let mut total = 0;
    let mut offset = 0;
    while let Some((block_size, isize)) = parse_block(&input[offset..]) {
        total += isize;
        offset += block_size;
    }
    total
}

fn inflate_block(
    input: &[u8],
    block_size: usize,
    out: &mut [u8],
    decompressor: &mut Decompressor,
) -> Result<(), &'static str> {
    let deflate_data = &input[BGZF_HEADER_SIZE..block_size - BGZF_TRAILER_SIZE];
    decompressor
        .deflate_decompress(deflate_data, out)
        .map(|_| ())
        .map_err(|_| ERR_INFLATE)
}

#[wasm_bindgen]
pub fn decompress_all(input: &[u8]) -> Result<Vec<u8>, JsError> {
    // A bad header on the *first* block means this isn't BGZF at all; a bad
    // header later just means truncated input, which we accept.
    if parse_block(input).is_none() {
        return Err(JsError::new(ERR_BAD_HEADER));
    }

    let mut output = vec![0u8; total_uncompressed_size(input)];
    let mut in_offset = 0;
    let mut out_offset = 0;

    with_decompressor(|decompressor| {
        while let Some((block_size, isize)) = parse_block(&input[in_offset..]) {
            inflate_block(
                &input[in_offset..],
                block_size,
                &mut output[out_offset..out_offset + isize],
                decompressor,
            )?;
            in_offset += block_size;
            out_offset += isize;
        }
        Ok::<_, &'static str>(())
    })
    .map_err(JsError::new)?;

    Ok(output)
}

#[wasm_bindgen]
pub struct ChunkSliceResult {
    buffer: Vec<u8>,
    // f64 maps to JS number, supporting files >4GB (safe up to 2^53 bytes)
    cpositions: Vec<f64>,
    dpositions: Vec<f64>,
}

#[wasm_bindgen]
impl ChunkSliceResult {
    pub fn take_buffer(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.buffer)
    }

    pub fn take_cpositions(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.cpositions)
    }

    pub fn take_dpositions(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.dpositions)
    }
}

/// Decompress a slice of BGZF data between two virtual offsets.
/// Position parameters use f64 to map to JS number, supporting files >4GB.
/// The input buffer should be a slice starting at min_block_position in the original file.
/// Positions are tracked as f64 to preserve precision for large files.
#[wasm_bindgen]
pub fn decompress_chunk_slice(
    input: &[u8],
    min_block_position: f64,
    min_data_position: f64,
    max_block_position: f64,
    max_data_position: f64,
) -> Result<ChunkSliceResult, JsError> {
    // Only convert to usize when indexing into the decompressed block
    let min_data_pos = min_data_position as usize;
    let max_data_pos = max_data_position as usize;

    if parse_block(input).is_none() {
        return Err(JsError::new(ERR_BAD_HEADER));
    }

    let mut cpositions: Vec<f64> = Vec::with_capacity(16);
    let mut dpositions: Vec<f64> = Vec::with_capacity(16);
    // Upper bound: full uncompressed size of the sliced blocks. The first/last
    // block trims reduce actual output slightly, so this never re-allocates.
    let mut buffer = Vec::with_capacity(total_uncompressed_size(input));

    // Byte offset within `input`; cpos/dpos stay f64 to preserve precision for
    // files past 2^32.
    let mut in_offset = 0;
    let mut dpos = min_data_position;

    with_decompressor(|decompressor| {
        SCRATCH.with(|scratch| {
            let mut scratch = scratch.borrow_mut();
            if scratch.len() < BGZF_MAX_BLOCK_SIZE {
                scratch.resize(BGZF_MAX_BLOCK_SIZE, 0);
            }

            while in_offset < input.len() {
                let remaining = &input[in_offset..];
                // A bad header past the first block means truncated input:
                // stop cleanly with what we have so far.
                let Some((block_size, isize)) = parse_block(remaining) else {
                    break;
                };
                let block = &mut scratch[..isize];
                inflate_block(remaining, block_size, block, decompressor)?;

                let cpos = min_block_position + in_offset as f64;
                cpositions.push(cpos);
                dpositions.push(dpos);

                let is_last = cpos >= max_block_position;
                let start = if in_offset == 0 { min_data_pos } else { 0 };
                let end = if is_last {
                    (max_data_pos + 1).min(isize)
                } else {
                    isize
                };

                if start < end {
                    buffer.extend_from_slice(&block[start..end]);
                }

                in_offset += block_size;
                dpos += isize.saturating_sub(start) as f64;

                if is_last {
                    cpositions.push(min_block_position + in_offset as f64);
                    dpositions.push(dpos);
                    break;
                }
            }
            Ok::<_, &'static str>(())
        })
    })
    .map_err(JsError::new)?;

    Ok(ChunkSliceResult {
        buffer,
        cpositions,
        dpositions,
    })
}
