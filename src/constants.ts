/**
 * The largest a single BGZF block can be, compressed or uncompressed: the
 * format caps both at 65 536 bytes (the block's size is carried in a 16-bit
 * BSIZE field in the gzip extra subfield, and the spec caps the uncompressed
 * payload to match).
 *
 * Exported because index-reading consumers need exactly this number and were
 * each restating it: the compressed length of a block is not recorded by a
 * .gzi/.tbi/.csi index, so a fetch that must contain the whole of some block
 * over-reads by one maximum-size block to be sure of covering it.
 */
export const MAX_BGZF_BLOCK_SIZE = 1 << 16
