use libdeflater::Decompressor;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

// Reuse decompressor to avoid allocation overhead on each call
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

    // Check magic bytes and compression method in one go
    if input[0] != 0x1f || input[1] != 0x8b || input[2] != 8 {
        return Err("invalid gzip header");
    }

    let flags = input[3];
    let mut pos = 10;

    // FEXTRA - this is where BGZF stores the block size
    let mut bsize = None;
    if flags & 0x04 != 0 {
        let xlen = u16::from_le_bytes([input[pos], input[pos + 1]]) as usize;
        pos += 2;

        let extra_end = pos + xlen;
        if input.len() < extra_end {
            return Err("truncated extra field");
        }

        // Fast path: BGZF always has BC subfield at fixed position
        // SI1='B'(0x42), SI2='C'(0x43), SLEN=2
        if xlen >= 6 && input[pos] == b'B' && input[pos + 1] == b'C' && input[pos + 2] == 2 && input[pos + 3] == 0 {
            bsize = Some(u16::from_le_bytes([input[pos + 4], input[pos + 5]]));
        }
        pos = extra_end;
    }

    // FNAME - null terminated string
    if flags & 0x08 != 0 {
        while pos < input.len() && input[pos] != 0 {
            pos += 1;
        }
        pos += 1;
    }

    // FCOMMENT - null terminated string
    if flags & 0x10 != 0 {
        while pos < input.len() && input[pos] != 0 {
            pos += 1;
        }
        pos += 1;
    }

    // FHCRC
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

    // Read ISIZE from trailer (last 4 bytes) - skip CRC32
    let trailer_pos = block_size - 8;
    let isize = u32::from_le_bytes([
        input[trailer_pos + 4],
        input[trailer_pos + 5],
        input[trailer_pos + 6],
        input[trailer_pos + 7],
    ]) as usize;

    let deflate_data = &input[header.header_size..trailer_pos];

    // Use thread-local decompressor to avoid allocation
    let data = DECOMPRESSOR.with(|d| {
        let mut decompressor = d.borrow_mut();
        let mut output = vec![0u8; isize];
        decompressor
            .deflate_decompress(deflate_data, &mut output)
            .map(|actual_size| {
                output.truncate(actual_size);
                output
            })
    }).map_err(|_| "decompression failed")?;

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
    pub fn data(&self) -> Vec<u8> {
        std::mem::take(&mut self.data.clone())
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
pub fn decompress_all(input: &[u8]) -> Result<Vec<u8>, JsError> {
    // Pre-allocate with estimate (typical BGZF compression ratio ~3-4x)
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

    Ok(output)
}

#[wasm_bindgen]
pub struct BlockInfo {
    data: Vec<u8>,
    compressed_offset: usize,
    compressed_size: usize,
}

#[wasm_bindgen]
impl BlockInfo {
    #[wasm_bindgen(getter)]
    pub fn data(&self) -> Vec<u8> {
        self.data.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn compressed_offset(&self) -> usize {
        self.compressed_offset
    }

    #[wasm_bindgen(getter)]
    pub fn compressed_size(&self) -> usize {
        self.compressed_size
    }
}

#[wasm_bindgen]
pub struct BlockResults {
    blocks: Vec<BlockInfo>,
}

#[wasm_bindgen]
impl BlockResults {
    #[wasm_bindgen(getter)]
    pub fn length(&self) -> usize {
        self.blocks.len()
    }

    pub fn get(&self, index: usize) -> Option<BlockInfo> {
        self.blocks.get(index).map(|b| BlockInfo {
            data: b.data.clone(),
            compressed_offset: b.compressed_offset,
            compressed_size: b.compressed_size,
        })
    }
}

#[wasm_bindgen]
pub fn decompress_all_blocks(input: &[u8]) -> Result<BlockResults, JsError> {
    let mut blocks = Vec::new();
    let mut offset = 0;

    while offset < input.len() {
        let result = decompress_block_internal(&input[offset..]).map_err(JsError::new)?;

        if result.bytes_read == 0 {
            break;
        }

        blocks.push(BlockInfo {
            data: result.data,
            compressed_offset: offset,
            compressed_size: result.bytes_read,
        });

        offset += result.bytes_read;
    }

    Ok(BlockResults { blocks })
}
