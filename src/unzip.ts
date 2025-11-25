import { inflate } from 'fflate'

import { concatUint8Array } from './util.ts'

// Type for the block cache
export interface BlockCache {
  get(key: string): { buffer: Uint8Array; nextIn: number } | undefined
  set(key: string, value: { buffer: Uint8Array; nextIn: number }): void
}

interface VirtualOffset {
  blockPosition: number
  dataPosition: number
}
interface Chunk {
  minv: VirtualOffset
  maxv: VirtualOffset
}

interface BgzfBlockInfo {
  blockSize: number
  deflateStart: number
  deflateEnd: number
}

function parseBgzfBlock(data: Uint8Array): BgzfBlockInfo {
  if (data[0] !== 0x1f || data[1] !== 0x8b) {
    throw new Error('Not a gzip file')
  }

  const flags = data[3]!
  let pos = 10
  let blockSize = 0

  if (flags & 0x04) {
    const xlen = data[pos]! | (data[pos + 1]! << 8)
    pos += 2
    const extraEnd = pos + xlen
    while (pos < extraEnd) {
      const si1 = data[pos]
      const si2 = data[pos + 1]
      const slen = data[pos + 2]! | (data[pos + 3]! << 8)
      if (si1 === 66 && si2 === 67 && slen === 2) {
        blockSize = (data[pos + 4]! | (data[pos + 5]! << 8)) + 1
      }
      pos += 4 + slen
    }
  }

  if (blockSize === 0) {
    throw new Error('Not a BGZF block: missing BSIZE in extra field')
  }

  // deflate data ends 8 bytes before block end (4 byte CRC32 + 4 byte ISIZE)
  return {
    blockSize,
    deflateStart: pos,
    deflateEnd: blockSize - 8,
  }
}

// Promisified inflate for parallel decompression without CRC validation
function inflateAsync(data: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // Note: can't use { consume: true } because data may be a subarray view
    inflate(data, (err, result) => {
      if (err) {
        reject(err)
      } else {
        resolve(result)
      }
    })
  })
}

// browserify-zlib, which is the zlib shim used by default in webpacked code,
// does not properly uncompress bgzf chunks that contain more than one bgzf
// block, so export an unzip function that uses fflate directly if we are running
// in a browser.
export async function unzip(inputData: Uint8Array) {
  try {
    // First pass: parse all block info and extract deflate payloads
    const blockInfos: { info: BgzfBlockInfo; deflateData: Uint8Array }[] = []
    let pos = 0
    let firstBlockError: Error | undefined

    while (pos < inputData.length) {
      const remainingInput = inputData.subarray(pos)
      if (remainingInput.length < 18) {
        break
      }

      let info: BgzfBlockInfo
      try {
        info = parseBgzfBlock(remainingInput)
      } catch (e) {
        // Save error from first block to throw if no blocks parsed
        if (blockInfos.length === 0) {
          firstBlockError = e as Error
        }
        break
      }

      if (info.blockSize > remainingInput.length) {
        break
      }

      const deflateData = remainingInput.subarray(
        info.deflateStart,
        info.deflateEnd,
      )
      blockInfos.push({ info, deflateData })
      pos += info.blockSize
    }

    // If no blocks parsed and we had an error, throw it
    if (blockInfos.length === 0 && firstBlockError) {
      throw firstBlockError
    }

    // Parallel decompression using async inflate (no CRC validation)
    const results = await Promise.all(
      blockInfos.map(({ deflateData }) => inflateAsync(deflateData)),
    )

    const totalLength = results.reduce((sum, r) => sum + r.length, 0)
    return concatUint8Array(results, totalLength)
  } catch (e) {
    if (/Not a gzip file/.exec(`${e}`)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw e
  }
}

// keeps track of the position of compressed blocks in terms of file offsets,
// and a decompressed equivalent
//
// also slices (0,minv.dataPosition) and (maxv.dataPosition,end) off
export async function unzipChunkSlice(
  inputData: Uint8Array,
  chunk: Chunk,
  blockCache?: BlockCache,
) {
  try {
    const { minv, maxv } = chunk
    let cpos = minv.blockPosition
    let firstBlockError: Error | undefined

    // First pass: gather block info and prepare for parallel decompression
    interface BlockWork {
      cpos: number
      nextIn: number
      cached: boolean
      buffer?: Uint8Array
      deflateData?: Uint8Array
    }

    const blockWork: BlockWork[] = []

    while (cpos < inputData.length + minv.blockPosition) {
      const remainingInput = inputData.subarray(cpos - minv.blockPosition)
      if (remainingInput.length < 18) {
        break
      }
      const cacheKey = cpos.toString()
      const cached = blockCache?.get(cacheKey)

      if (cached) {
        blockWork.push({
          cpos,
          nextIn: cached.nextIn,
          cached: true,
          buffer: cached.buffer,
        })
        if (cpos >= maxv.blockPosition) {
          break
        }
        cpos += cached.nextIn
      } else {
        let info: BgzfBlockInfo
        try {
          info = parseBgzfBlock(remainingInput)
        } catch (e) {
          if (blockWork.length === 0) {
            firstBlockError = e as Error
          }
          break
        }
        if (info.blockSize > remainingInput.length) {
          break
        }
        const deflateData = remainingInput.subarray(
          info.deflateStart,
          info.deflateEnd,
        )
        blockWork.push({
          cpos,
          nextIn: info.blockSize,
          cached: false,
          deflateData,
        })
        if (cpos >= maxv.blockPosition) {
          break
        }
        cpos += info.blockSize
      }
    }

    // If no blocks parsed and we had an error, throw it
    if (blockWork.length === 0 && firstBlockError) {
      throw firstBlockError
    }

    // Parallel decompression for non-cached blocks
    const uncachedIndices = blockWork
      .map((b, i) => (!b.cached ? i : -1))
      .filter(i => i !== -1)

    const inflateResults = await Promise.all(
      uncachedIndices.map(i => inflateAsync(blockWork[i]!.deflateData!)),
    )

    // Assign results back and update cache
    for (let j = 0; j < uncachedIndices.length; j++) {
      const i = uncachedIndices[j]!
      const work = blockWork[i]!
      work.buffer = inflateResults[j]
      blockCache?.set(work.cpos.toString(), {
        // @ts-expect-error
        buffer: work.buffer,
        nextIn: work.nextIn,
      })
    }

    // Now process results sequentially to build output
    const chunks: Uint8Array[] = []
    const cpositions: number[] = []
    const dpositions: number[] = []
    let dpos = minv.dataPosition
    let totalLength = 0

    for (let i = 0; i < blockWork.length; i++) {
      const work = blockWork[i]!
      let buffer = work.buffer!

      cpositions.push(work.cpos)
      dpositions.push(dpos)

      let len = buffer.length
      if (i === 0 && minv.dataPosition) {
        buffer = buffer.subarray(minv.dataPosition)
        len = buffer.length
      }

      if (work.cpos >= maxv.blockPosition) {
        buffer = buffer.subarray(
          0,
          maxv.blockPosition === minv.blockPosition
            ? maxv.dataPosition - minv.dataPosition + 1
            : maxv.dataPosition + 1,
        )
        chunks.push(buffer)
        totalLength += buffer.length
        cpositions.push(work.cpos + work.nextIn)
        dpositions.push(dpos + len)
        break
      }

      chunks.push(buffer)
      totalLength += len
      dpos += len
    }

    return {
      buffer: concatUint8Array(chunks, totalLength),
      cpositions,
      dpositions,
    }
  } catch (e) {
    if (/Not a gzip file/.exec(`${e}`)) {
      throw new Error(
        'problem decompressing block: incorrect gzip header check',
      )
    }
    throw e
  }
}
