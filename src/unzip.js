const zlib = require('zlib')
const { promisify } = require('es6-promisify')
const { unzip: pakoUnzip, unzipChunk, unzipChunkSlice } = require('./unzip-pako')

const gunzip = promisify(zlib.gunzip)

// in node, just use the native unzipping with Z_SYNC_FLUSH
function nodeUnzip(input) {
  return gunzip(input, {
    finishFlush: (zlib.constants || zlib).Z_SYNC_FLUSH,
  })
}

module.exports = {
  unzip: nodeUnzip,
  unzipChunk,
  unzipChunkSlice,
  nodeUnzip,
  pakoUnzip,
}
