use flate2::bufread::GzDecoder;
use std::io::{Cursor, Read};
use wasm_bindgen::prelude::*;

/// Internal result type for decompression
struct InternalDecompressResult {
    data: Vec<u8>,
    bytes_read: usize,
}

/// Internal function to decompress a single gzip member
fn decompress_block_internal(input: &[u8]) -> Result<InternalDecompressResult, String> {
    if input.is_empty() {
        return Ok(InternalDecompressResult {
            data: Vec::new(),
            bytes_read: 0,
        });
    }

    // Cursor<&[u8]> implements BufRead, so we can use bufread::GzDecoder directly
    let cursor = Cursor::new(input);
    let mut decoder = GzDecoder::new(cursor);

    let mut output = Vec::new();
    decoder.read_to_end(&mut output).map_err(|e| e.to_string())?;

    // Get bytes consumed from the underlying cursor
    let bytes_read = decoder.into_inner().position() as usize;

    Ok(InternalDecompressResult {
        data: output,
        bytes_read,
    })
}

/// Result of decompressing a single gzip block (for WASM export)
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

/// Decompress a single gzip member from the input buffer.
/// Returns the decompressed data and the number of bytes consumed from input.
#[wasm_bindgen]
pub fn decompress_block(input: &[u8]) -> Result<DecompressResult, JsError> {
    let result = decompress_block_internal(input).map_err(|e| JsError::new(&e))?;
    Ok(DecompressResult {
        data: result.data,
        bytes_read: result.bytes_read,
    })
}

/// Decompress all gzip members from input, returning concatenated data.
#[wasm_bindgen]
pub fn decompress_all(input: &[u8]) -> Result<Vec<u8>, JsError> {
    let mut output = Vec::new();
    let mut offset = 0;

    while offset < input.len() {
        let result = decompress_block_internal(&input[offset..])
            .map_err(|e| JsError::new(&e))?;

        if result.bytes_read == 0 {
            break;
        }

        output.extend_from_slice(&result.data);
        offset += result.bytes_read;
    }

    Ok(output)
}

/// Result of decompressing all blocks with position tracking
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

/// Container for multiple block results
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

/// Decompress all blocks and return them separately with position info.
#[wasm_bindgen]
pub fn decompress_all_blocks(input: &[u8]) -> Result<BlockResults, JsError> {
    let mut blocks = Vec::new();
    let mut offset = 0;

    while offset < input.len() {
        let result = decompress_block_internal(&input[offset..])
            .map_err(|e| JsError::new(&e))?;

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
