import fs from 'node:fs'

import { LocalFile } from 'generic-filehandle2'
import { describe, expect, test } from 'vitest'

import { BgzfFilehandle } from '../src/index.ts'

import type {
  BufferEncoding,
  FilehandleOptions,
  Stats,
} from 'generic-filehandle2'

// Counts calls to the underlying filehandle. Blocks are adjacent in the file,
// so a read spanning N blocks must still be one contiguous fetch — over HTTP
// each extra call is a separate range request.
class CountingFile {
  reads = 0
  bytes = 0
  private inner: LocalFile

  constructor(path: string) {
    this.inner = new LocalFile(path)
  }

  read(length: number, position: number, opts?: FilehandleOptions) {
    this.reads++
    this.bytes += length
    // opts is accepted to satisfy GenericFilehandle, but LocalFile.read takes
    // no options argument at all -- it cannot honour a signal.
    void opts
    return this.inner.read(length, position)
  }
  // The overload pair rather than one signature, because GenericFilehandle's
  // readFile is overloaded on `encoding` and a single-signature override does
  // not satisfy it. `pnpm typecheck` covers test/ where `pnpm build` does not,
  // so this is caught here rather than in CI.
  readFile(
    options?: Omit<FilehandleOptions, 'encoding'>,
  ): Promise<Uint8Array<ArrayBuffer>>
  readFile(
    options:
      | BufferEncoding
      | (Omit<FilehandleOptions, 'encoding'> & { encoding: BufferEncoding }),
  ): Promise<string>
  readFile(): Promise<Uint8Array<ArrayBuffer> | string> {
    return this.inner.readFile()
  }
  stat(): Promise<Stats> {
    throw new Error('stat() must not be called')
  }
  close() {
    return this.inner.close()
  }
}

function dataPath(basename: string) {
  return require.resolve(`./data/${basename}`)
}

async function makeCounted() {
  const counter = new CountingFile(dataPath('T_ko.2bit.gz'))
  const f = new BgzfFilehandle({
    filehandle: counter,
    gziFilehandle: new LocalFile(dataPath('T_ko.2bit.gz.gzi')),
  })
  // warm the gzi so subsequent counts reflect data reads only
  await f.read(1, 0)
  counter.reads = 0
  counter.bytes = 0
  return { f, counter }
}

describe('block read coalescing', () => {
  test('a read spanning several blocks issues one underlying read', async () => {
    const { f, counter } = await makeCounted()
    const truth = fs.readFileSync(dataPath('T_ko.2bit'))

    // 200 KB spans four 64 KB blocks
    const buf = await f.read(200000, 100000)
    expect([...buf]).toEqual([...truth.subarray(100000, 300000)])
    expect(counter.reads).toBe(1)
  })

  test('whole-file read issues one underlying read', async () => {
    const { f, counter } = await makeCounted()
    const truth = fs.readFileSync(dataPath('T_ko.2bit'))

    const buf = await f.read(truth.length, 0)
    expect([...buf]).toEqual([...truth])
    expect(counter.reads).toBe(1)
  })

  test('does not fetch bytes before the first relevant block', async () => {
    const { f, counter } = await makeCounted()
    const truth = fs.readFileSync(dataPath('T_ko.2bit'))

    // last 8 KB: must not drag in the whole file
    await f.read(8192, truth.length - 8192)
    expect(counter.reads).toBe(1)
    expect(counter.bytes).toBeLessThanOrEqual(1 << 16)
  })

  // Batches are decompressed whole and sliced, so the returned view must be
  // detached from its (much larger) backing block buffer — consumers routinely
  // do `new DataView(buf.buffer)`.
  test('returned buffer is exactly the requested bytes', async () => {
    const { f } = await makeCounted()

    for (const [length, position] of [
      [300, 0],
      [1000, 70000],
      [200000, 100000],
    ]) {
      const buf = await f.read(length!, position!)
      expect(buf.byteOffset).toBe(0)
      expect(buf.buffer.byteLength).toBe(length)
    }
  })

  test('random ranges are byte-exact against the uncompressed source', async () => {
    const { f } = await makeCounted()
    const truth = fs.readFileSync(dataPath('T_ko.2bit'))

    let seed = 42
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let i = 0; i < 300; i++) {
      const position = rnd(truth.length)
      const length = 1 + rnd(200000)
      const buf = await f.read(length, position)
      const want = truth.subarray(position, position + length)
      // Buffer.compare rather than spreading: 300 × 200 KB of array literals
      // is orders of magnitude slower than the reads under test
      expect(buf.length).toBe(want.length)
      expect(Buffer.compare(Buffer.from(buf), want)).toBe(0)
    }
  })
})
