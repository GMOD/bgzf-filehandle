const zlib = require('zlib')
const { promisify } = require('es6-promisify')

const gunzip = promisify(zlib.gunzip)

const { Z_SYNC_FLUSH, Inflate } = require('pako')

// browserify-zlib, which is the zlib shim used by default in webpacked code,
// does not properly uncompress bgzf chunks that contain more than
// one bgzf block, so export an unzip function that uses pako directly
// if we are running in a browser.
async function pakoUnzip(inputData) {
  let strm
  let pos = 0
  let i = 0
  const chunks = []
  let inflator
  do {
    const remainingInput = inputData.slice(pos)
    inflator = new Inflate()
    ;({ strm } = inflator)
    inflator.push(remainingInput, Z_SYNC_FLUSH)
    if (inflator.err) throw new Error(inflator.msg)

    pos += strm.next_in
    chunks[i] = Buffer.from(inflator.result)
    i += 1
  } while (strm.avail_in)

  const result = Buffer.concat(chunks)
  return result
}

// similar to pakounzip, except it does extra counting
// to return the positions of compressed and decompressed
// data offsets
async function unzipChunk(inputData) {
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
    // @ts-ignore
    inflator.push(remainingInput, Z_SYNC_FLUSH)
    if (inflator.err) throw new Error(inflator.msg)

    // @ts-ignore
    const buffer = Buffer.from(inflator.result)
    blocks.push(buffer)

    cpositions.push(cpos)
    dpositions.push(dpos)

    cpos += strm.next_in
    dpos += buffer.length
  } while (strm.avail_in)

  const buffer = Buffer.concat(blocks)
  return { buffer, cpositions, dpositions }
}

// similar to unzipChunk above but slices (0,minv.dataPosition) and (maxv.dataPosition,end) off
async function unzipChunkSlice(inputData, chunk) {
  let strm
  let cpos = 0
  let dpos = 0
  const decompressedBlocks = []
  const cpositions = []
  const dpositions = []
  do {
    const remainingInput = inputData.slice(cpos)
    const inflator = new Inflate()
    // @ts-ignore
    ;({ strm } = inflator)
    // @ts-ignore
    inflator.push(remainingInput, Z_SYNC_FLUSH)
    if (inflator.err) throw new Error(inflator.msg)

    // @ts-ignore
    const buffer = Buffer.from(inflator.result)
    decompressedBlocks.push(buffer)

    if (decompressedBlocks.length === 1 && chunk.minv.dataPosition) {
      // this is the first chunk, trim it
      decompressedBlocks[0] = decompressedBlocks[0].slice(
        chunk.minv.dataPosition,
      )
    }
    const origCpos = cpos
    cpos += strm.next_in
    dpos += buffer.length
    cpositions.push(cpos)
    dpositions.push(dpos)
    if (chunk.minv.blockPosition + origCpos >= chunk.maxv.blockPosition) {
      // this is the last chunk, trim it and stop decompressing
      // note if it is the same block is minv it subtracts that already
      // trimmed part of the slice length

      decompressedBlocks[decompressedBlocks.length - 1] = decompressedBlocks[
        decompressedBlocks.length - 1
      ].slice(
        0,
        chunk.maxv.blockPosition === chunk.minv.blockPosition
          ? chunk.maxv.dataPosition - chunk.minv.dataPosition + 1
          : chunk.maxv.dataPosition + 1,
      )

      break
    }
  } while (strm.avail_in)

  const buffer = Buffer.concat(decompressedBlocks)
  return { buffer, cpositions, dpositions }
}

// in node, just use the native unzipping with Z_SYNC_FLUSH
function nodeUnzip(input) {
  return gunzip(input, {
    finishFlush: (zlib.constants || zlib).Z_SYNC_FLUSH,
  })
}

module.exports = {
  unzip: typeof __webpack_require__ === 'function' ? pakoUnzip : nodeUnzip, // eslint-disable-line
  unzipChunk,
  nodeUnzip,
  pakoUnzip,
}
