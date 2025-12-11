use libdeflater::Decompressor;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

const BGZF_MAX_UNCOMPRESSED: usize = 65536;

thread_local! {
    static DECOMPRESSOR: RefCell<Decompressor> = RefCell::new(Decompressor::new());
    // Reusable output buffer to avoid repeated allocations
    static OUTPUT_BUF: RefCell<Vec<u8>> = RefCell::new(vec![0u8; BGZF_MAX_UNCOMPRESSED]);
}

#[inline(always)]
fn parse_bgzf_header(input: &[u8]) -> Option<(usize, usize)> {
    // BGZF has a fixed header structure - optimize for it
    // Minimum BGZF block: 18 header + 8 trailer = 26 bytes
    if input.len() < 26 {
        return None;
    }

    // Check: magic (1f 8b), method (08), flags (04 = FEXTRA)
    if input[0] != 0x1f || input[1] != 0x8b || input[2] != 8 || input[3] != 4 {
        return None;
    }

    // BGZF always has XLEN=6, SI1='B', SI2='C', SLEN=2 at fixed positions
    // pos 10-11: XLEN (should be 6)
    // pos 12: SI1 ('B')
    // pos 13: SI2 ('C')
    // pos 14-15: SLEN (should be 2)
    // pos 16-17: BSIZE
    if input[10] != 6 || input[11] != 0
        || input[12] != b'B' || input[13] != b'C'
        || input[14] != 2 || input[15] != 0
    {
        return None;
    }

    let bsize = u16::from_le_bytes([input[16], input[17]]) as usize + 1;

    if input.len() < bsize || bsize < 26 {
        return None;
    }

    // Header is always 18 bytes for standard BGZF
    Some((18, bsize))
}

#[inline(always)]
fn decompress_bgzf_block(input: &[u8]) -> Result<(Vec<u8>, usize), &'static str> {
    if input.is_empty() {
        return Ok((Vec::new(), 0));
    }

    let (header_size, block_size) = parse_bgzf_header(input).ok_or("invalid bgzf header")?;

    // Read ISIZE from trailer (last 4 bytes of block)
    let trailer_pos = block_size - 8;
    let isize = u32::from_le_bytes([
        input[trailer_pos + 4],
        input[trailer_pos + 5],
        input[trailer_pos + 6],
        input[trailer_pos + 7],
    ]) as usize;

    let deflate_data = &input[header_size..trailer_pos];

    // Use thread-local buffer when possible to avoid allocation
    let data = if isize <= BGZF_MAX_UNCOMPRESSED {
        OUTPUT_BUF.with(|buf| {
            DECOMPRESSOR.with(|d| {
                let mut decompressor = d.borrow_mut();
                let mut output = buf.borrow_mut();
                decompressor
                    .deflate_decompress(deflate_data, &mut output[..isize])
                    .map(|actual_size| output[..actual_size].to_vec())
            })
        })
    } else {
        DECOMPRESSOR.with(|d| {
            let mut decompressor = d.borrow_mut();
            let mut output = vec![0u8; isize];
            decompressor
                .deflate_decompress(deflate_data, &mut output)
                .map(|actual_size| {
                    output.truncate(actual_size);
                    output
                })
        })
    }
    .map_err(|_| "decompression failed")?;

    Ok((data, block_size))
}

#[wasm_bindgen]
pub struct DecompressResult {
    data: Vec<u8>,
    bytes_read: usize,
}

#[wasm_bindgen]
impl DecompressResult {
    #[wasm_bindgen(getter)]
    pub fn data(&self) -> js_sys::Uint8Array {
        js_sys::Uint8Array::from(&self.data[..])
    }

    #[wasm_bindgen(getter)]
    pub fn bytes_read(&self) -> usize {
        self.bytes_read
    }
}

#[wasm_bindgen]
pub fn decompress_block(input: &[u8]) -> Result<DecompressResult, JsError> {
    let (data, bytes_read) = decompress_bgzf_block(input).map_err(JsError::new)?;
    Ok(DecompressResult { data, bytes_read })
}

#[wasm_bindgen]
pub fn decompress_all(input: &[u8]) -> Result<js_sys::Uint8Array, JsError> {
    let mut output = Vec::with_capacity(input.len() * 4);
    let mut offset = 0;

    while offset < input.len() {
        let (data, bytes_read) = decompress_bgzf_block(&input[offset..]).map_err(JsError::new)?;

        if bytes_read == 0 {
            break;
        }

        output.extend_from_slice(&data);
        offset += bytes_read;
    }

    Ok(js_sys::Uint8Array::from(&output[..]))
}

#[wasm_bindgen]
pub struct ChunkSliceResult {
    buffer: Vec<u8>,
    cpositions: Vec<u32>,
    dpositions: Vec<u32>,
}

#[wasm_bindgen]
impl ChunkSliceResult {
    #[wasm_bindgen(getter)]
    pub fn buffer(&self) -> js_sys::Uint8Array {
        js_sys::Uint8Array::from(&self.buffer[..])
    }

    #[wasm_bindgen(getter)]
    pub fn cpositions(&self) -> js_sys::Uint32Array {
        js_sys::Uint32Array::from(&self.cpositions[..])
    }

    #[wasm_bindgen(getter)]
    pub fn dpositions(&self) -> js_sys::Uint32Array {
        js_sys::Uint32Array::from(&self.dpositions[..])
    }
}

#[wasm_bindgen]
pub fn decompress_chunk_slice(
    input: &[u8],
    min_block_position: u32,
    min_data_position: u32,
    max_block_position: u32,
    max_data_position: u32,
) -> Result<ChunkSliceResult, JsError> {
    let min_block_pos = min_block_position as usize;
    let min_data_pos = min_data_position as usize;
    let max_block_pos = max_block_position as usize;
    let max_data_pos = max_data_position as usize;

    // Pre-allocate with reasonable capacity
    let mut cpositions: Vec<u32> = Vec::with_capacity(16);
    let mut dpositions: Vec<u32> = Vec::with_capacity(16);
    let mut buffer = Vec::with_capacity(input.len() * 4);

    let mut cpos = min_block_pos;
    let mut dpos = min_data_pos;
    let mut is_first = true;

    while cpos - min_block_pos < input.len() {
        let input_offset = cpos - min_block_pos;

        let (block_data, bytes_read) =
            decompress_bgzf_block(&input[input_offset..]).map_err(JsError::new)?;

        if bytes_read == 0 {
            break;
        }

        cpositions.push(cpos as u32);
        dpositions.push(dpos as u32);

        let is_last = cpos >= max_block_pos;
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

        cpos += bytes_read;
        dpos += block_len - start;
        is_first = false;

        if is_last {
            cpositions.push(cpos as u32);
            dpositions.push(dpos as u32);
            break;
        }
    }

    Ok(ChunkSliceResult {
        buffer,
        cpositions,
        dpositions,
    })
}
