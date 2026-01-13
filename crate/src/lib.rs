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

fn get_block_output_size(input: &[u8], block_size: usize) -> usize {
    let trailer_pos = block_size - BGZF_TRAILER_SIZE;
    u32::from_le_bytes([
        input[trailer_pos + 4],
        input[trailer_pos + 5],
        input[trailer_pos + 6],
        input[trailer_pos + 7],
    ]) as usize
}

fn decompress_block_into_slice(
    input: &[u8],
    block_size: usize,
    output: &mut [u8],
    decompressor: &mut Decompressor,
) -> Result<(), &'static str> {
    let trailer_pos = block_size - BGZF_TRAILER_SIZE;
    let deflate_data = &input[BGZF_HEADER_SIZE..trailer_pos];

    decompressor
        .deflate_decompress(deflate_data, output)
        .map_err(|_| "decompression failed")?;

    Ok(())
}

fn decompress_block_with_size(
    input: &[u8],
    block_size: usize,
    decompressor: &mut Decompressor,
) -> Result<Vec<u8>, &'static str> {
    let isize = get_block_output_size(input, block_size);
    let mut output = vec![0u8; isize];
    decompress_block_into_slice(input, block_size, &mut output, decompressor)?;
    Ok(output)
}

fn decompress_block_into(
    input: &[u8],
    decompressor: &mut Decompressor,
) -> Result<(Vec<u8>, usize), &'static str> {
    let block_size = parse_bgzf_header(input).ok_or("invalid bgzf header")?;
    let output = decompress_block_with_size(input, block_size, decompressor)?;
    Ok((output, block_size))
}

#[wasm_bindgen]
pub struct DecompressResult {
    data: Vec<u8>,
    bytes_read: usize,
}

#[wasm_bindgen]
impl DecompressResult {
    #[wasm_bindgen(getter)]
    pub fn data(&self) -> Vec<u8> {
        self.data.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn bytes_read(&self) -> usize {
        self.bytes_read
    }
}

#[wasm_bindgen]
pub fn decompress_block(input: &[u8]) -> Result<DecompressResult, JsError> {
    if input.is_empty() {
        return Ok(DecompressResult {
            data: Vec::new(),
            bytes_read: 0,
        });
    }
    let mut decompressor = Decompressor::new();
    let (data, bytes_read) =
        decompress_block_into(input, &mut decompressor).map_err(JsError::new)?;
    Ok(DecompressResult { data, bytes_read })
}

#[wasm_bindgen]
pub fn decompress_all(input: &[u8]) -> Result<Vec<u8>, JsError> {
    let mut decompressor = Decompressor::new();
    let mut output = Vec::with_capacity(input.len() * 4);
    let mut offset = 0;

    while offset < input.len() {
        let remaining = &input[offset..];

        let block_size = match parse_bgzf_header(remaining) {
            Some(size) => size,
            None => {
                if offset == 0 {
                    return Err(JsError::new("invalid bgzf header"));
                }
                break;
            }
        };

        let output_size = get_block_output_size(remaining, block_size);
        let output_start = output.len();
        output.resize(output_start + output_size, 0);
        decompress_block_into_slice(
            remaining,
            block_size,
            &mut output[output_start..],
            &mut decompressor,
        )
        .map_err(JsError::new)?;

        offset += block_size;
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
    #[wasm_bindgen(getter)]
    pub fn buffer(&self) -> Vec<u8> {
        self.buffer.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn cpositions(&self) -> Vec<f64> {
        self.cpositions.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn dpositions(&self) -> Vec<f64> {
        self.dpositions.clone()
    }
}

/// Decompress a slice of BGZF data between two virtual offsets.
/// Position parameters use f64 to map to JS number, supporting files >4GB.
#[wasm_bindgen]
pub fn decompress_chunk_slice(
    input: &[u8],
    min_block_position: f64,
    min_data_position: f64,
    max_block_position: f64,
    max_data_position: f64,
) -> Result<ChunkSliceResult, JsError> {
    let min_block_pos = min_block_position as usize;
    let min_data_pos = min_data_position as usize;
    let max_block_pos = max_block_position as usize;
    let max_data_pos = max_data_position as usize;

    let mut decompressor = Decompressor::new();
    let mut cpositions: Vec<f64> = Vec::with_capacity(16);
    let mut dpositions: Vec<f64> = Vec::with_capacity(16);
    let mut buffer = Vec::with_capacity(input.len() * 4);
    // Reusable scratch buffer, grows as needed
    let mut scratch: Vec<u8> = Vec::new();

    let mut cpos = min_block_pos;
    let mut dpos = min_data_pos;
    let mut is_first = true;

    while cpos - min_block_pos < input.len() {
        let input_offset = cpos - min_block_pos;
        let remaining = &input[input_offset..];

        let block_size = match parse_bgzf_header(remaining) {
            Some(size) => size,
            None => {
                if cpos == min_block_pos {
                    return Err(JsError::new("invalid bgzf header"));
                }
                break;
            }
        };

        let output_size = get_block_output_size(remaining, block_size);
        if scratch.len() < output_size {
            scratch.resize(output_size, 0);
        }
        decompress_block_into_slice(
            remaining,
            block_size,
            &mut scratch[..output_size],
            &mut decompressor,
        )
        .map_err(JsError::new)?;

        cpositions.push(cpos as f64);
        dpositions.push(dpos as f64);

        let is_last = cpos >= max_block_pos;

        let start = if is_first { min_data_pos } else { 0 };
        let end = if is_last {
            (max_data_pos + 1).min(output_size)
        } else {
            output_size
        };

        if start < end {
            buffer.extend_from_slice(&scratch[start..end]);
        }

        cpos += block_size;
        dpos += output_size - start;
        is_first = false;

        if is_last {
            cpositions.push(cpos as f64);
            dpositions.push(dpos as f64);
            break;
        }
    }

    Ok(ChunkSliceResult {
        buffer,
        cpositions,
        dpositions,
    })
}
