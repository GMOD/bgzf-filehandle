const zlib = require('zlib')
const gunzip = require('util.promisify')(zlib.gunzip)

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
    strm = inflator.strm
    inflator.push(remainingInput, Z_SYNC_FLUSH)
    if (inflator.err) {
      if (chunks.length) {
        break
      } else {
        throw new Error(inflator.msg)
      }
    }

    pos += strm.next_in
    chunks[i] = Buffer.from(inflator.result)
    i += 1
  } while (strm.avail_in)

  const result = Buffer.concat(chunks)
  return result
}

// in node, just use the native unzipping with Z_SYNC_FLUSH
function nodeUnzip(input) {
  return gunzip(input, {
    finishFlush: (zlib.constants || zlib).Z_SYNC_FLUSH,
  })
}

module.exports = {
  unzip: typeof __webpack_require__ === 'function' ? pakoUnzip : nodeUnzip, // eslint-disable-line
  nodeUnzip,
  pakoUnzip,
}
