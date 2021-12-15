//@ts-ignore
import { Z_SYNC_FLUSH, Inflate } from 'pako'

interface VirtualOffset {
  blockPosition: number
  dataPosition: number
}
interface Chunk {
  minv: VirtualOffset
  maxv: VirtualOffset
}

// browserify-zlib, which is the zlib shim used by default in webpacked code,
// does not properly uncompress bgzf chunks that contain more than
// one bgzf block, so export an unzip function that uses pako directly
// if we are running in a browser.
async function unzip(inputData: Buffer) {
  try {
    let strm
    let pos = 0
    let i = 0
    const chunks = []
    let inflator
    do {
      const remainingInput = inputData.slice(pos)
      inflator = new Inflate()
      //@ts-ignore
      ;({ strm } = inflator)
      inflator.push(remainingInput, Z_SYNC_FLUSH)
      if (inflator.err) {
        throw new Error(inflator.msg)
      }

      pos += strm.next_in
      chunks[i] = Buffer.from(inflator.result)
      i += 1
    } while (strm.avail_in)

    const result = Buffer.concat(chunks)
    return result
  } catch (e) {
    //cleanup error message
    if (`${e}`.match(/incorrect header check/)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw e
  }
}

// similar to pakounzip, except it does extra counting
// to return the positions of compressed and decompressed
// data offsets
async function unzipChunk(inputData: Buffer) {
  try {
    let strm
    let cpos = 0
    let dpos = 0
    const blocks = []
    const cpositions = []
    const dpositions = []
    do {
      const remainingInput = inputData.slice(cpos)
      const inflator = new Inflate()
      // @ts-ignore
      ;({ strm } = inflator)
      inflator.push(remainingInput, Z_SYNC_FLUSH)
      if (inflator.err) {
        throw new Error(inflator.msg)
      }

      const buffer = Buffer.from(inflator.result)
      blocks.push(buffer)

      cpositions.push(cpos)
      dpositions.push(dpos)

      cpos += strm.next_in
      dpos += buffer.length
    } while (strm.avail_in)

    const buffer = Buffer.concat(blocks)
    return { buffer, cpositions, dpositions }
  } catch (e) {
    //cleanup error message
    if (`${e}`.match(/incorrect header check/)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw e
  }
}

// similar to unzipChunk above but slices (0,minv.dataPosition) and (maxv.dataPosition,end) off
async function unzipChunkSlice(inputData: Buffer, chunk: Chunk) {
  try {
    let strm
    const { minv, maxv } = chunk
    let cpos = minv.blockPosition
    let dpos = minv.dataPosition
    const decompressedBlocks = []
    const cpositions = []
    const dpositions = []
    do {
      const remainingInput = inputData.slice(cpos - minv.blockPosition)
      const inflator = new Inflate()
      // @ts-ignore
      ;({ strm } = inflator)
      inflator.push(remainingInput, Z_SYNC_FLUSH)
      if (inflator.err) {
        throw new Error(inflator.msg)
      }

      const buffer = Buffer.from(inflator.result)
      decompressedBlocks.push(buffer)
      let len = buffer.length

      cpositions.push(cpos)
      dpositions.push(dpos)
      if (decompressedBlocks.length === 1 && minv.dataPosition) {
        // this is the first chunk, trim it
        decompressedBlocks[0] = decompressedBlocks[0].slice(minv.dataPosition)
        len = decompressedBlocks[0].length
      }
      const origCpos = cpos
      cpos += strm.next_in
      dpos += len

      if (origCpos >= maxv.blockPosition) {
        // this is the last chunk, trim it and stop decompressing
        // note if it is the same block is minv it subtracts that already
        // trimmed part of the slice length

        decompressedBlocks[decompressedBlocks.length - 1] = decompressedBlocks[
          decompressedBlocks.length - 1
        ].slice(
          0,
          maxv.blockPosition === minv.blockPosition
            ? maxv.dataPosition - minv.dataPosition + 1
            : maxv.dataPosition + 1,
        )

        cpositions.push(cpos)
        dpositions.push(dpos)
        break
      }
    } while (strm.avail_in)

    const buffer = Buffer.concat(decompressedBlocks)
    return { buffer, cpositions, dpositions }
  } catch (e) {
    //cleanup error message
    if (`${e}`.match(/incorrect header check/)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw e
  }
}

function nodeUnzip() {
  throw new Error('nodeUnzip not implemented.')
}

export { unzip, unzipChunk, unzipChunkSlice, unzip as pakoUnzip, nodeUnzip }
