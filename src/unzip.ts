import zlib from 'zlib'
import { Buffer } from 'buffer'
import { promisify } from 'es6-promisify'

const gunzip = promisify(zlib.gunzip)

// in node, just use the native unzipping with Z_SYNC_FLUSH
function nodeUnzip(input: Buffer): Promise<Buffer> {
  //@ts-ignore
  return gunzip(input, {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    finishFlush: (zlib.constants || zlib).Z_SYNC_FLUSH,
  })
}

export { nodeUnzip as unzip, nodeUnzip }

export { pakoUnzip, unzipChunkSlice, unzipChunk } from './unzip-pako'
