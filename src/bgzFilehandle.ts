import {
  LocalFile,
  GenericFilehandle,
  FilehandleOptions,
} from 'generic-filehandle2'

// locals
import { unzip } from './unzip'
import GziIndex from './gziIndex'
import { concatUint8Arrays } from './util'

export default class BgzFilehandle implements GenericFilehandle {
  filehandle: GenericFilehandle
  gzi: GziIndex

  constructor({
    filehandle,
    path,
    gziFilehandle,
    gziPath,
  }: {
    filehandle?: GenericFilehandle
    path?: string
    gziFilehandle?: GenericFilehandle
    gziPath?: string
  }) {
    if (filehandle) {
      this.filehandle = filehandle
    } else if (path) {
      this.filehandle = new LocalFile(path)
    } else {
      throw new TypeError('either filehandle or path must be defined')
    }

    if (!gziFilehandle && !gziPath && !path) {
      throw new TypeError('either gziFilehandle or gziPath must be defined')
    }

    this.gzi = new GziIndex({
      filehandle: gziFilehandle,
      path: !gziFilehandle && !gziPath && path ? gziPath : `${path}.gzi`,
    })
  }

  async stat() {
    const compressedStat = await this.filehandle.stat()
    return Object.assign(compressedStat, {
      size: await this.getUncompressedFileSize(),
    })
  }

  async getUncompressedFileSize() {
    // read the last block's ISIZE (see gzip RFC),
    // and add it to its uncompressedPosition
    const [, uncompressedPosition] = await this.gzi.getLastBlock()

    const { size } = await this.filehandle.stat()

    // note: there should be a 28-byte EOF marker (an empty block) at
    // the end of the file, so we skip backward past that
    const buf = await this.filehandle.read(4, size - 28 - 4)
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    const lastBlockUncompressedSize = dv.getUint32(0, true)
    return uncompressedPosition + lastBlockUncompressedSize
  }

  async _readAndUncompressBlock(
    [compressedPosition]: [number],
    [nextCompressedPosition]: [number],
  ) {
    let next = nextCompressedPosition
    if (!next) {
      next = (await this.filehandle.stat()).size
    }

    // read the compressed data into the block buffer
    const blockCompressedLength = next - compressedPosition

    const buf = await this.filehandle.read(
      blockCompressedLength,
      compressedPosition,
    )

    // uncompress it
    return unzip(buf.subarray(0, blockCompressedLength))
  }

  async read(length: number, position: number) {
    let buf = new Uint8Array()
    // get the block positions for this read
    const blockPositions = await this.gzi.getRelevantBlocksForRead(
      length,
      position,
    )

    for (let i = 0; i < blockPositions.length - 1; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const uncompressedBuffer = await this._readAndUncompressBlock(
        blockPositions[i],
        blockPositions[i + 1],
      )
      const [, uncompressedPosition] = blockPositions[i]
      const sourceOffset =
        uncompressedPosition >= position ? 0 : position - uncompressedPosition
      const sourceEnd =
        Math.min(
          position + length,
          uncompressedPosition + uncompressedBuffer.length,
        ) - uncompressedPosition
      if (sourceOffset >= 0 && sourceOffset < uncompressedBuffer.length) {
        buf = concatUint8Arrays([
          buf,
          uncompressedBuffer.subarray(sourceOffset, sourceEnd),
        ])
      }
    }

    return buf
  }

  async close(): Promise<void> {
    return
  }

  public async readFile(): Promise<Buffer>
  public async readFile(options: BufferEncoding): Promise<string>
  public async readFile<T extends undefined>(
    options:
      | Omit<FilehandleOptions, 'encoding'>
      | (Omit<FilehandleOptions, 'encoding'> & { encoding: T }),
  ): Promise<Buffer>
  public async readFile<T extends BufferEncoding>(
    options: Omit<FilehandleOptions, 'encoding'> & { encoding: T },
  ): Promise<string>
  readFile<T extends BufferEncoding>(
    options: Omit<FilehandleOptions, 'encoding'> & { encoding: T },
  ): T extends BufferEncoding ? Promise<Buffer> : Promise<Buffer | string>
  async readFile(options: FilehandleOptions | BufferEncoding = {}) {
    const data = await this.filehandle.readFile()
    const buf = await unzip(data)
    const encoding = typeof options === 'string' ? options : options.encoding
    if (encoding === 'utf8') {
      const decoder = new TextDecoder('utf8')
      return decoder.decode(buf)
    } else {
      return buf
    }
  }
}
