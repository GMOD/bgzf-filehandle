/* eslint-disable */
if (typeof __webpack_require__ === 'function') {
  const { Z_SYNC_FLUSH, Inflate } = require('pako')

  // browserify-zlib, which is the zlib shim used by default in webpacked code,
  // does not properly uncompress bgzf chunks that contain more than
  // one bgzf block, so export an unzip function that uses pako directly
  // if we are running in a browser.
  async function unzip(inputData) {
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
      if (inflator.err) throw new Error(inflator.msg)

      pos += strm.next_in
      chunks[i] = inflator.result
      i += 1
    } while (strm.avail_in)

    const result = Buffer.concat(chunks)
    return result
  }

  module.exports = unzip
} else {
  // in node, just use the native unzipping with Z_SYNC_FLUSH
  const zlib = require('zlib')
  const nodeUnzip = require('util.promisify')(zlib.gunzip)

  module.exports = function unzip(input) {
    return nodeUnzip(input, {
      finishFlush: (zlib.constants || zlib).Z_SYNC_FLUSH,
    })
  }
}
