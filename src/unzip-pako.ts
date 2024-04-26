import { Buffer } from 'buffer'
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
// does not properly uncompress bgzf chunks that contain more than one bgzf
// block, so export an unzip function that uses pako directly if we are running
// in a browser.
//
//
// eslint-disable-next-line @typescript-eslint/require-await
async function unzip(inputData: Buffer) {
  try {
    let strm
    let pos = 0
    let i = 0
    const chunks = []
    let totalSize = 0
    let inflator
    do {
      const remainingInput = inputData.subarray(pos)
      inflator = new Inflate()
      //@ts-ignore
      ;({ strm } = inflator)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      inflator.push(remainingInput, Z_SYNC_FLUSH)
      if (inflator.err) {
        throw new Error(inflator.msg)
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      pos += strm.next_in
      chunks[i] = inflator.result as Uint8Array
      totalSize += chunks[i].length
      i += 1
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    } while (strm.avail_in)

    const result = new Uint8Array(totalSize)
    for (let i = 0, offset = 0; i < chunks.length; i++) {
      result.set(chunks[i], offset)
      offset += chunks[i].length
    }
    return Buffer.from(result)
  } catch (error) {
    //cleanup error message
    if (/incorrect header check/.test(`${error}`)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw error
  }
}

// similar to pakounzip, except it does extra counting to return the positions
// of compressed and decompressed data offsets
//
// eslint-disable-next-line @typescript-eslint/require-await
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      inflator.push(remainingInput, Z_SYNC_FLUSH)
      if (inflator.err) {
        throw new Error(inflator.msg)
      }

      const buffer = Buffer.from(inflator.result)
      blocks.push(buffer)

      cpositions.push(cpos)
      dpositions.push(dpos)

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      cpos += strm.next_in
      dpos += buffer.length
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    } while (strm.avail_in)

    const buffer = Buffer.concat(blocks)
    return { buffer, cpositions, dpositions }
  } catch (error) {
    //cleanup error message
    if (/incorrect header check/.test(`${error}`)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw error
  }
}

// similar to unzipChunk above but slices (0,minv.dataPosition) and
// (maxv.dataPosition,end) off
//
// eslint-disable-next-line @typescript-eslint/require-await
async function unzipChunkSlice(inputData: Buffer, chunk: Chunk) {
  try {
    let strm
    const { minv, maxv } = chunk
    let cpos = minv.blockPosition
    let dpos = minv.dataPosition
    const chunks = []
    const cpositions = []
    const dpositions = []

    let totalSize = 0
    let i = 0
    do {
      const remainingInput = inputData.subarray(cpos - minv.blockPosition)
      const inflator = new Inflate()
      // @ts-ignore
      ;({ strm } = inflator)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      inflator.push(remainingInput, Z_SYNC_FLUSH)
      if (inflator.err) {
        throw new Error(inflator.msg)
      }

      const buffer = inflator.result
      chunks.push(buffer as Uint8Array)
      let len = buffer.length

      cpositions.push(cpos)
      dpositions.push(dpos)
      if (chunks.length === 1 && minv.dataPosition) {
        // this is the first chunk, trim it
        chunks[0] = chunks[0].subarray(minv.dataPosition)
        len = chunks[0].length
      }
      const origCpos = cpos
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      cpos += strm.next_in
      dpos += len

      if (origCpos >= maxv.blockPosition) {
        // this is the last chunk, trim it and stop decompressing
        // note if it is the same block is minv it subtracts that already
        // trimmed part of the slice length

        chunks[i] = chunks[i].subarray(
          0,
          maxv.blockPosition === minv.blockPosition
            ? maxv.dataPosition - minv.dataPosition + 1
            : maxv.dataPosition + 1,
        )

        cpositions.push(cpos)
        dpositions.push(dpos)
        totalSize += chunks[i].length
        break
      }
      totalSize += chunks[i].length
      i++
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    } while (strm.avail_in)

    const result = new Uint8Array(totalSize)
    for (let i = 0, offset = 0; i < chunks.length; i++) {
      result.set(chunks[i], offset)
      offset += chunks[i].length
    }
    const buffer = Buffer.from(result)

    return { buffer, cpositions, dpositions }
  } catch (error) {
    //cleanup error message
    if (/incorrect header check/.test(`${error}`)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw error
  }
}

function nodeUnzip() {
  throw new Error('nodeUnzip not implemented.')
}

export { unzip, unzipChunk, unzipChunkSlice, unzip as pakoUnzip, nodeUnzip }
