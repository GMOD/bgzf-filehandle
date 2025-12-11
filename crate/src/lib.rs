use libdeflater::{DecompressionError, Decompressor};
use wasm_bindgen::prelude::*;

struct GzipHeader {
    header_size: usize,
    // BGZF stores uncompressed size in BSIZE field (extra field)
    bsize: Option<u16>,
}

fn parse_gzip_header(input: &[u8]) -> Result<GzipHeader, String> {
    if input.len() < 10 {
        return Err("input too short for gzip header".to_string());
    }

    // Check magic bytes
    if input[0] != 0x1f || input[1] != 0x8b {
        return Err("invalid gzip magic bytes".to_string());
    }

    // Check compression method (must be 8 = deflate)
    if input[2] != 8 {
        return Err("unsupported compression method".to_string());
    }

    let flags = input[3];
    let mut pos = 10; // Skip fixed header

    // FEXTRA
    let mut bsize = None;
    if flags & 0x04 != 0 {
        if input.len() < pos + 2 {
            return Err("truncated extra field".to_string());
        }
        let xlen = u16::from_le_bytes([input[pos], input[pos + 1]]) as usize;
        pos += 2;

        // Parse extra subfields looking for BGZF BC field
        let extra_end = pos + xlen;
        if input.len() < extra_end {
            return Err("truncated extra field data".to_string());
        }

        let mut extra_pos = pos;
        while extra_pos + 4 <= extra_end {
            let si1 = input[extra_pos];
            let si2 = input[extra_pos + 1];
            let slen = u16::from_le_bytes([input[extra_pos + 2], input[extra_pos + 3]]) as usize;
            extra_pos += 4;

            if si1 == b'B' && si2 == b'C' && slen == 2 && extra_pos + 2 <= extra_end {
                // BGZF block size field (total block size - 1)
                bsize = Some(u16::from_le_bytes([input[extra_pos], input[extra_pos + 1]]));
            }
            extra_pos += slen;
        }
        pos = extra_end;
    }

    // FNAME
    if flags & 0x08 != 0 {
        while pos < input.len() && input[pos] != 0 {
            pos += 1;
        }
        pos += 1; // Skip null terminator
    }

    // FCOMMENT
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

    if pos > input.len() {
        return Err("truncated gzip header".to_string());
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

fn decompress_block_internal(input: &[u8]) -> Result<InternalDecompressResult, String> {
    if input.is_empty() {
        return Ok(InternalDecompressResult {
            data: Vec::new(),
            bytes_read: 0,
        });
    }

    let header = parse_gzip_header(input)?;

    // If we have BSIZE, we know the total block size
    let block_size = if let Some(bsize) = header.bsize {
        (bsize as usize) + 1
    } else {
        // For non-BGZF gzip, we need to find the end differently
        // The trailer is 8 bytes (4 CRC32 + 4 ISIZE)
        // We'll use the ISIZE to know the uncompressed size
        if input.len() < header.header_size + 8 {
            return Err("input too short for gzip data".to_string());
        }
        // Can't determine block size without scanning - fall back to using all input
        input.len()
    };

    if input.len() < block_size {
        return Err("input shorter than indicated block size".to_string());
    }

    // Trailer is last 8 bytes: CRC32 (4) + ISIZE (4)
    if block_size < header.header_size + 8 {
        return Err("block too small for header and trailer".to_string());
    }

    let trailer_pos = block_size - 8;
    let _crc32 = u32::from_le_bytes([
        input[trailer_pos],
        input[trailer_pos + 1],
        input[trailer_pos + 2],
        input[trailer_pos + 3],
    ]);
    let isize = u32::from_le_bytes([
        input[trailer_pos + 4],
        input[trailer_pos + 5],
        input[trailer_pos + 6],
        input[trailer_pos + 7],
    ]) as usize;

    // Deflate data is between header and trailer
    let deflate_data = &input[header.header_size..trailer_pos];

    // Decompress
    let mut decompressor = Decompressor::new();
    let mut output = vec![0u8; isize.max(1)]; // Use exact size from trailer

    let actual_size = decompressor
        .deflate_decompress(deflate_data, &mut output)
        .map_err(|e| match e {
            DecompressionError::BadData => "bad compressed data".to_string(),
            DecompressionError::InsufficientSpace => "insufficient output space".to_string(),
        })?;

    output.truncate(actual_size);

    Ok(InternalDecompressResult {
        data: output,
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
        self.data.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn bytes_read(&self) -> usize {
        self.bytes_read
    }
}

#[wasm_bindgen]
pub fn decompress_block(input: &[u8]) -> Result<DecompressResult, JsError> {
    let result = decompress_block_internal(input).map_err(|e| JsError::new(&e))?;
    Ok(DecompressResult {
        data: result.data,
        bytes_read: result.bytes_read,
    })
}

#[wasm_bindgen]
pub fn decompress_all(input: &[u8]) -> Result<Vec<u8>, JsError> {
    let mut output = Vec::with_capacity(input.len() * 4);
    let mut offset = 0;

    while offset < input.len() {
        let result =
            decompress_block_internal(&input[offset..]).map_err(|e| JsError::new(&e))?;

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
        let result =
            decompress_block_internal(&input[offset..]).map_err(|e| JsError::new(&e))?;

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
