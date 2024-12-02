//@ts-ignore
import { Z_SYNC_FLUSH, Inflate } from 'pako'
import { concatUint8Array } from './util'

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
async function unzip(inputData: Uint8Array) {
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
      inflator.push(remainingInput, Z_SYNC_FLUSH)
      if (inflator.err) {
        throw new Error(inflator.msg)
      }

      pos += strm.next_in
      chunks[i] = inflator.result as Uint8Array
      totalSize += chunks[i]!.length
      i += 1
    } while (strm.avail_in)

    const result = new Uint8Array(totalSize)
    for (let i = 0, offset = 0; i < chunks.length; i++) {
      result.set(chunks[i]!, offset)
      offset += chunks[i]!.length
    }
    return result
  } catch (e) {
    //cleanup error message
    if (/incorrect header check/.exec(`${e}`)) {
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
async function unzipChunk(inputData: Uint8Array) {
  try {
    let strm
    let cpos = 0
    let dpos = 0
    const blocks = [] as Uint8Array[]
    const cpositions = [] as number[]
    const dpositions = [] as number[]
    do {
      const remainingInput = inputData.slice(cpos)
      const inflator = new Inflate()
      // @ts-ignore
      ;({ strm } = inflator)
      inflator.push(remainingInput, Z_SYNC_FLUSH)
      if (inflator.err) {
        throw new Error(inflator.msg)
      }

      const buffer = inflator.result as Uint8Array
      blocks.push(buffer)

      cpositions.push(cpos)
      dpositions.push(dpos)

      cpos += strm.next_in
      dpos += buffer.length
    } while (strm.avail_in)

    const buffer = concatUint8Array(blocks)
    return {
      buffer,
      cpositions,
      dpositions,
    }
  } catch (e) {
    //cleanup error message
    if (/incorrect header check/.exec(`${e}`)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw e
  }
}

// similar to unzipChunk above but slices (0,minv.dataPosition) and
// (maxv.dataPosition,end) off
async function unzipChunkSlice(inputData: Uint8Array, chunk: Chunk) {
  try {
    let strm
    const { minv, maxv } = chunk
    let cpos = minv.blockPosition
    let dpos = minv.dataPosition
    const chunks = [] as Uint8Array[]
    const cpositions = [] as number[]
    const dpositions = [] as number[]

    let i = 0
    do {
      const remainingInput = inputData.subarray(cpos - minv.blockPosition)
      const inflator = new Inflate()
      // @ts-ignore
      ;({ strm } = inflator)
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
        chunks[0] = chunks[0]!.subarray(minv.dataPosition)
        len = chunks[0].length
      }
      const origCpos = cpos
      cpos += strm.next_in
      dpos += len

      if (origCpos >= maxv.blockPosition) {
        // this is the last chunk, trim it and stop decompressing
        // note if it is the same block is minv it subtracts that already
        // trimmed part of the slice length

        chunks[i] = chunks[i]!.subarray(
          0,
          maxv.blockPosition === minv.blockPosition
            ? maxv.dataPosition - minv.dataPosition + 1
            : maxv.dataPosition + 1,
        )

        cpositions.push(cpos)
        dpositions.push(dpos)
        break
      }
      i++
    } while (strm.avail_in)

    const buffer = concatUint8Array(chunks)

    return { buffer, cpositions, dpositions }
  } catch (e) {
    //cleanup error message
    if (/incorrect header check/.exec(`${e}`)) {
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
