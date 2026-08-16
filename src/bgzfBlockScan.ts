/** Where one BGZF block sits, and how big it is on both sides of the inflate. */
export interface BgzfBlockInfo {
  /** Offset of the block's first byte within the scanned buffer. */
  inputOffset: number
  /** Length of the block as it appears in the file, header and trailer included. */
  compressedSize: number
  /** Length of the block once inflated, read from its `ISIZE` trailer. */
  decompressedSize: number
  /** Offset of the block's first byte within the file — a virtual offset's `blockPosition`. */
  filePosition: number
}

const BGZF_HEADER_SIZE = 18
const BGZF_TRAILER_SIZE = 8
const BGZF_MIN_BLOCK_SIZE = BGZF_HEADER_SIZE + BGZF_TRAILER_SIZE

/**
 * Walk a buffer's BGZF block boundaries without decompressing anything, reading
 * each block's `BSIZE` header field and `ISIZE` trailer field.
 *
 * @param input - compressed bytes whose FIRST byte is the block at
 * `minBlockPosition`. Scanning is relative to the buffer, so passing a whole
 * file while claiming it starts mid-file mislabels every `filePosition`.
 * @param minBlockPosition - the file offset `input` starts at, i.e. a chunk's
 * `minv.blockPosition`.
 * @param maxBlockPosition - the last block wanted, i.e. `maxv.blockPosition`.
 * That block is included; scanning also stops early at the end of `input` or
 * at the first bytes that are not a valid BGZF header.
 */
export function scanBgzfBlocks(
  input: Uint8Array,
  minBlockPosition: number,
  maxBlockPosition: number,
) {
  const blocks: BgzfBlockInfo[] = []
  let offset = 0
  let filePosition = minBlockPosition

  while (offset + BGZF_MIN_BLOCK_SIZE <= input.length) {
    if (
      input[offset] !== 0x1f ||
      input[offset + 1] !== 0x8b ||
      input[offset + 2] !== 8 ||
      input[offset + 3] !== 4
    ) {
      break
    }

    if (
      input[offset + 10] !== 6 ||
      input[offset + 12] !== 0x42 ||
      input[offset + 13] !== 0x43
    ) {
      break
    }

    const bsize = (input[offset + 16]! | (input[offset + 17]! << 8)) + 1

    if (bsize < BGZF_MIN_BLOCK_SIZE || offset + bsize > input.length) {
      break
    }

    const trailerPos = offset + bsize - BGZF_TRAILER_SIZE
    const isize =
      (input[trailerPos + 4]! |
        (input[trailerPos + 5]! << 8) |
        (input[trailerPos + 6]! << 16) |
        (input[trailerPos + 7]! << 24)) >>>
      0

    blocks.push({
      inputOffset: offset,
      compressedSize: bsize,
      decompressedSize: isize,
      filePosition,
    })

    if (filePosition >= maxBlockPosition) {
      break
    }

    offset += bsize
    filePosition += bsize
  }

  return blocks
}
