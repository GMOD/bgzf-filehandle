import zlib from 'zlib'
import { Buffer } from 'buffer'
import { promisify } from 'es6-promisify'
import { pakoUnzip, unzipChunk, unzipChunkSlice } from './unzip-pako'

const gunzip = promisify(zlib.gunzip)

// in node, just use the native unzipping with Z_SYNC_FLUSH
function nodeUnzip(input: Uint8Array): Promise<Uint8Array> {
  const buf = Buffer.from(input)
  //@ts-expect-error
  return gunzip(buf, {
    finishFlush: (zlib.constants || zlib).Z_SYNC_FLUSH,
  })
}

export { nodeUnzip as unzip, unzipChunk, unzipChunkSlice, nodeUnzip, pakoUnzip }
