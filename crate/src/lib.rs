use libdeflater::Decompressor;
use wasm_bindgen::prelude::*;

const BGZF_HEADER_SIZE: usize = 18;
const BGZF_TRAILER_SIZE: usize = 8;
const BGZF_MIN_BLOCK_SIZE: usize = BGZF_HEADER_SIZE + BGZF_TRAILER_SIZE;

fn parse_bgzf_header(input: &[u8]) -> Option<usize> {
    if input.len() < BGZF_MIN_BLOCK_SIZE {
        return None;
    }

    // Check fixed BGZF header bytes in one comparison where possible
    // magic (1f 8b), method (08), flags (04)
    if input[0] != 0x1f || input[1] != 0x8b || input[2] != 8 || input[3] != 4 {
        return None;
    }

    // XLEN=6, SI1='B', SI2='C', SLEN=2
    if input[10] != 6 || input[12] != b'B' || input[13] != b'C' {
        return None;
    }

    let bsize = u16::from_le_bytes([input[16], input[17]]) as usize + 1;

    if input.len() >= bsize && bsize >= BGZF_MIN_BLOCK_SIZE {
        Some(bsize)
    } else {
        None
    }
}

// Sum the uncompressed sizes (ISIZE, last 4 bytes of each BGZF block trailer)
// so callers can allocate the output buffer exactly once. Avoids the old
// `input.len() * 4` guess, which over-allocated the grow-only WASM heap by
// hundreds of MB on deep-coverage regions (and could double-realloc when the
// guess was low). Stops at the first block whose header/trailer doesn't fit,
// matching the truncated-input handling in the decompress loops.
fn total_uncompressed_size(input: &[u8]) -> usize {
    let mut total = 0;
    let mut offset = 0;
    while let Some(block_size) = parse_bgzf_header(&input[offset..]) {
        let trailer_pos = offset + block_size - BGZF_TRAILER_SIZE;
        if trailer_pos + 8 > input.len() {
            break;
        }
        total += u32::from_le_bytes([
            input[trailer_pos + 4],
            input[trailer_pos + 5],
            input[trailer_pos + 6],
            input[trailer_pos + 7],
        ]) as usize;
        offset += block_size;
        if offset + BGZF_MIN_BLOCK_SIZE > input.len() {
            break;
        }
    }
    total
}

fn decompress_block_into(
    input: &[u8],
    decompressor: &mut Decompressor,
) -> Result<(Vec<u8>, usize), &'static str> {
    let block_size = parse_bgzf_header(input).ok_or("invalid bgzf header")?;

    let trailer_pos = block_size - BGZF_TRAILER_SIZE;
    let isize = u32::from_le_bytes([
        input[trailer_pos + 4],
        input[trailer_pos + 5],
        input[trailer_pos + 6],
        input[trailer_pos + 7],
    ]) as usize;

    let deflate_data = &input[BGZF_HEADER_SIZE..trailer_pos];
    let mut output = vec![0u8; isize];

    decompressor
        .deflate_decompress(deflate_data, &mut output)
        .map_err(|_| "decompression failed")?;

    Ok((output, block_size))
}

#[wasm_bindgen]
pub fn decompress_all(input: &[u8]) -> Result<Vec<u8>, JsError> {
    let mut decompressor = Decompressor::new();
    let mut output = Vec::with_capacity(total_uncompressed_size(input));
    let mut offset = 0;

    while offset < input.len() {
        let remaining = &input[offset..];

        match decompress_block_into(remaining, &mut decompressor) {
            Ok((data, bytes_read)) => {
                output.extend_from_slice(&data);
                offset += bytes_read;
            }
            // first block with a bad header: surface the error. A later bad
            // header means truncated input — stop with what we have so far.
            Err("invalid bgzf header") if offset > 0 => break,
            Err(e) => return Err(JsError::new(e)),
        }
    }

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
    // Use f64 for position tracking to support >4GB files
    // Only convert to usize when indexing into the input buffer
    let min_data_pos = min_data_position as usize;
    let max_data_pos = max_data_position as usize;

    let mut decompressor = Decompressor::new();
    let mut cpositions: Vec<f64> = Vec::with_capacity(16);
    let mut dpositions: Vec<f64> = Vec::with_capacity(16);
    // Upper bound: full uncompressed size of the sliced blocks. The first/last
    // block trims reduce actual output slightly, so this never re-allocates.
    let mut buffer = Vec::with_capacity(total_uncompressed_size(input));

    // Track positions as f64 to preserve precision for large files
    let mut cpos = min_block_position;
    let mut dpos = min_data_position;

    // input_offset is the position within the input buffer (always fits in usize)
    // since input buffer size is limited by available memory
    while (cpos - min_block_position) < (input.len() as f64) {
        let input_offset = (cpos - min_block_position) as usize;
        let remaining = &input[input_offset..];

        let (block_data, bytes_read) = match decompress_block_into(remaining, &mut decompressor) {
            Ok(v) => v,
            Err(e) => {
                // first block invalid: surface the error; later block invalid
                // (truncated input): stop cleanly with what we have so far.
                if cpos == min_block_position {
                    return Err(JsError::new(e));
                }
                break;
            }
        };

        cpositions.push(cpos);
        dpositions.push(dpos);

        let is_first = cpos == min_block_position;
        let is_last = cpos >= max_block_position;
        let block_len = block_data.len();

        let start = if is_first { min_data_pos } else { 0 };
        let end = if is_last {
            (max_data_pos + 1).min(block_len)
        } else {
            block_len
        };

        if start < end {
            buffer.extend_from_slice(&block_data[start..end]);
        }

        cpos += bytes_read as f64;
        dpos += (block_len - start) as f64;

        if is_last {
            cpositions.push(cpos);
            dpositions.push(dpos);
            break;
        }
    }

    Ok(ChunkSliceResult {
        buffer,
        cpositions,
        dpositions,
    })
}
