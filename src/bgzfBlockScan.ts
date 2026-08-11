export interface BgzfBlockInfo {
  inputOffset: number
  compressedSize: number
  decompressedSize: number
  filePosition: number
}

const BGZF_HEADER_SIZE = 18
const BGZF_TRAILER_SIZE = 8
const BGZF_MIN_BLOCK_SIZE = BGZF_HEADER_SIZE + BGZF_TRAILER_SIZE

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
