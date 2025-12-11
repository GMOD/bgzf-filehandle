use libdeflater::Decompressor;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

thread_local! {
    static DECOMPRESSOR: RefCell<Decompressor> = RefCell::new(Decompressor::new());
}

struct GzipHeader {
    header_size: usize,
    bsize: Option<u16>,
}

fn parse_gzip_header(input: &[u8]) -> Result<GzipHeader, &'static str> {
    if input.len() < 18 {
        return Err("input too short for gzip header");
    }

    if input[0] != 0x1f || input[1] != 0x8b || input[2] != 8 {
        return Err("invalid gzip header");
    }

    let flags = input[3];
    let mut pos = 10;

    let mut bsize = None;
    if flags & 0x04 != 0 {
        let xlen = u16::from_le_bytes([input[pos], input[pos + 1]]) as usize;
        pos += 2;

        let extra_end = pos + xlen;
        if input.len() < extra_end {
            return Err("truncated extra field");
        }

        if xlen >= 6
            && input[pos] == b'B'
            && input[pos + 1] == b'C'
            && input[pos + 2] == 2
            && input[pos + 3] == 0
        {
            bsize = Some(u16::from_le_bytes([input[pos + 4], input[pos + 5]]));
        }
        pos = extra_end;
    }

    if flags & 0x08 != 0 {
        while pos < input.len() && input[pos] != 0 {
            pos += 1;
        }
        pos += 1;
    }

    if flags & 0x10 != 0 {
        while pos < input.len() && input[pos] != 0 {
            pos += 1;
        }
        pos += 1;
    }

    if flags & 0x02 != 0 {
        pos += 2;
    }

    Ok(GzipHeader {
        header_size: pos,
        bsize,
    })
}

struct InternalDecompressResult {
    data: Vec<u8>,
    bytes_read: usize,
}

fn decompress_block_internal(input: &[u8]) -> Result<InternalDecompressResult, &'static str> {
    if input.is_empty() {
        return Ok(InternalDecompressResult {
            data: Vec::new(),
            bytes_read: 0,
        });
    }

    let header = parse_gzip_header(input)?;

    let block_size = match header.bsize {
        Some(bsize) => (bsize as usize) + 1,
        None => input.len(),
    };

    if input.len() < block_size || block_size < header.header_size + 8 {
        return Err("invalid block size");
    }

    let trailer_pos = block_size - 8;
    let isize = u32::from_le_bytes([
        input[trailer_pos + 4],
        input[trailer_pos + 5],
        input[trailer_pos + 6],
        input[trailer_pos + 7],
    ]) as usize;

    let deflate_data = &input[header.header_size..trailer_pos];

    let data = DECOMPRESSOR
        .with(|d| {
            let mut decompressor = d.borrow_mut();
            let mut output = vec![0u8; isize];
            decompressor
                .deflate_decompress(deflate_data, &mut output)
                .map(|actual_size| {
                    output.truncate(actual_size);
                    output
                })
        })
        .map_err(|_| "decompression failed")?;

    Ok(InternalDecompressResult {
        data,
        bytes_read: block_size,
    })
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
    let result = decompress_block_internal(input).map_err(JsError::new)?;
    Ok(DecompressResult {
        data: result.data,
        bytes_read: result.bytes_read,
    })
}

#[wasm_bindgen]
pub fn decompress_all(input: &[u8]) -> Result<js_sys::Uint8Array, JsError> {
    let mut output = Vec::with_capacity(input.len() * 4);
    let mut offset = 0;

    while offset < input.len() {
        let result = decompress_block_internal(&input[offset..]).map_err(JsError::new)?;

        if result.bytes_read == 0 {
            break;
        }

        output.extend_from_slice(&result.data);
        offset += result.bytes_read;
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

    let mut cpositions: Vec<u32> = Vec::new();
    let mut dpositions: Vec<u32> = Vec::new();
    let mut buffer = Vec::with_capacity(input.len() * 4);

    let mut cpos = min_block_pos;
    let mut dpos = min_data_pos;

    while cpos < input.len() + min_block_pos {
        let input_offset = cpos - min_block_pos;
        if input_offset >= input.len() {
            break;
        }

        let result = decompress_block_internal(&input[input_offset..]).map_err(JsError::new)?;

        if result.bytes_read == 0 {
            break;
        }

        cpositions.push(cpos as u32);
        dpositions.push(dpos as u32);

        let is_first = buffer.is_empty() && cpositions.len() == 1;
        let is_last = cpos >= max_block_pos;

        let block_data = &result.data;
        let start = if is_first { min_data_pos } else { 0 };

        let end = if is_last {
            if cpos == min_block_pos {
                max_data_pos + 1
            } else {
                max_data_pos + 1
            }
            .min(block_data.len())
        } else {
            block_data.len()
        };

        if start < end && start < block_data.len() {
            buffer.extend_from_slice(&block_data[start..end]);
        }

        let len = result.data.len();
        cpos += result.bytes_read;
        dpos += len - start;

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
