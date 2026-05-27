import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { LocalFile } from 'generic-filehandle2'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { BgzfFilehandle } from '../src/index.ts'

import type { FilehandleOptions, Stats } from 'generic-filehandle2'

// Wraps a real LocalFile but tracks/intercepts stat() calls. Used to prove
// the trailing-block read path never depends on stat() — and continues to
// work correctly when stat() throws or lies.
class StatWatcher {
  public statCalls = 0
  public statBehavior: 'throw' | 'lie-zero' | 'lie-huge' | 'lie-small' = 'throw'

  constructor(private inner: LocalFile) {}

  read(length: number, position: number, opts?: FilehandleOptions) {
    return this.inner.read(length, position, opts)
  }
  readFile() {
    return this.inner.readFile()
  }
  async stat(): Promise<Stats> {
    this.statCalls++
    if (this.statBehavior === 'throw') {
      throw new Error(
        'stat() must not be called by BgzfFilehandle — trailing-block reads should use the gzi index + MAX_BGZF_BLOCK_SIZE over-read',
      )
    }
    if (this.statBehavior === 'lie-zero') {
      return { size: 0 }
    }
    if (this.statBehavior === 'lie-huge') {
      return { size: 1e15 }
    }
    return { size: 1 } // lie-small
  }
  close() {
    return this.inner.close()
  }
}

function makeBgzf(
  filehandle: GenericFilehandle,
  gziPath: string,
  blockConcurrency = 10,
) {
  return new BgzfFilehandle({
    filehandle,
    gziFilehandle: new LocalFile(gziPath),
    blockConcurrency,
  })
}

function dataPath(basename: string) {
  return require.resolve(`./data/${basename}`)
}

describe('BgzfFilehandle no-stat trailing-block reads', () => {
  // single-block file (gzi has no real entries): every read hits the trailing
  // block path where nextCompressedPosition is undefined
  test('reads last bytes of single-block file without calling stat', async () => {
    const watcher = new StatWatcher(
      new LocalFile(dataPath('gff3_with_syncs.gff3.gz')),
    )
    const f = makeBgzf(watcher, dataPath('gff3_with_syncs.gff3.gz.gzi'))
    const truth = fs.readFileSync(dataPath('gff3_with_syncs.gff3'))

    // last 100 bytes of the uncompressed file
    const buf = await f.read(100, truth.length - 100)
    expect(buf.length).toBe(100)
    expect([...buf]).toEqual([...truth.subarray(- 100)])
    expect(watcher.statCalls).toBe(0)
  })

  test('reads exactly to EOF without calling stat', async () => {
    const watcher = new StatWatcher(
      new LocalFile(dataPath('gff3_with_syncs.gff3.gz')),
    )
    const f = makeBgzf(watcher, dataPath('gff3_with_syncs.gff3.gz.gzi'))
    const truth = fs.readFileSync(dataPath('gff3_with_syncs.gff3'))

    const buf = await f.read(truth.length, 0)
    expect(buf.length).toBe(truth.length)
    expect([...buf]).toEqual([...truth])
    expect(watcher.statCalls).toBe(0)
  })

  test('over-read past uncompressed EOF returns only available bytes', async () => {
    const watcher = new StatWatcher(
      new LocalFile(dataPath('gff3_with_syncs.gff3.gz')),
    )
    const f = makeBgzf(watcher, dataPath('gff3_with_syncs.gff3.gz.gzi'))
    const truth = fs.readFileSync(dataPath('gff3_with_syncs.gff3'))

    // request 10x the actual file length
    const buf = await f.read(truth.length * 10, 0)
    // exact length depends on whether the final BGZF block's uncompressed size
    // matches the source — at minimum we must get every byte of source
    expect(buf.length).toBeGreaterThanOrEqual(truth.length)
    expect([...buf.subarray(0, truth.length)]).toEqual([...truth])
    expect(watcher.statCalls).toBe(0)
  })

  test('multi-block file: last block reads correctly without stat', async () => {
    const watcher = new StatWatcher(new LocalFile(dataPath('T_ko.2bit.gz')))
    const f = makeBgzf(watcher, dataPath('T_ko.2bit.gz.gzi'))
    const truth = fs.readFileSync(dataPath('T_ko.2bit'))

    // last 8 KiB of a multi-block file — exercises trailing-block path even
    // though there are many gzi entries before it
    const buf = await f.read(8192, truth.length - 8192)
    expect(buf.length).toBe(8192)
    expect([...buf]).toEqual([...truth.subarray(- 8192)])
    expect(watcher.statCalls).toBe(0)
  })

  test('reads succeed when underlying stat() lies with size:0', async () => {
    // simulates the CORS / cache-race lie where a filehandle reports size 0
    // for a non-empty file. Our reads must not consult that lie.
    const watcher = new StatWatcher(
      new LocalFile(dataPath('gff3_with_syncs.gff3.gz')),
    )
    watcher.statBehavior = 'lie-zero'
    const f = makeBgzf(watcher, dataPath('gff3_with_syncs.gff3.gz.gzi'))
    const truth = fs.readFileSync(dataPath('gff3_with_syncs.gff3'))

    const buf = await f.read(500, 0)
    expect(buf.length).toBe(500)
    expect([...buf]).toEqual([...truth.subarray(0, 500)])
    // stat may be defensively called by other code paths, but for our reads
    // we expect 0 calls
    expect(watcher.statCalls).toBe(0)
  })

  test('reads succeed when underlying stat() returns absurd huge size', async () => {
    const watcher = new StatWatcher(
      new LocalFile(dataPath('gff3_with_syncs.gff3.gz')),
    )
    watcher.statBehavior = 'lie-huge'
    const f = makeBgzf(watcher, dataPath('gff3_with_syncs.gff3.gz.gzi'))
    const truth = fs.readFileSync(dataPath('gff3_with_syncs.gff3'))

    const buf = await f.read(truth.length, 0)
    expect([...buf]).toEqual([...truth])
    expect(watcher.statCalls).toBe(0)
  })

  test('reads succeed when underlying stat() throws every time', async () => {
    const watcher = new StatWatcher(
      new LocalFile(dataPath('gff3_with_syncs.gff3.gz')),
    )
    // default behavior is 'throw'
    const f = makeBgzf(watcher, dataPath('gff3_with_syncs.gff3.gz.gzi'))
    const truth = fs.readFileSync(dataPath('gff3_with_syncs.gff3'))

    // a variety of reads — start, middle, end — must all succeed without any
    // unhandled stat() rejection
    const a = await f.read(50, 0)
    expect([...a]).toEqual([...truth.subarray(0, 50)])
    const b = await f.read(50, 1000)
    expect([...b]).toEqual([...truth.subarray(1000, 1050)])
    const c = await f.read(50, truth.length - 50)
    expect([...c]).toEqual([...truth.subarray(- 50)])
    expect(watcher.statCalls).toBe(0)
  })
})

// Generates a fresh fixture at test time so we can exercise specific size
// alignments without committing more binary files to the repo. Skipped if the
// bgzip CLI isn't on PATH.
describe('BgzfFilehandle generated fixtures', () => {
  let tmpdir: string
  let available = false

  beforeAll(() => {
    const probe = spawnSync('bgzip', ['--version'])
    if (probe.error || probe.status !== 0) {return}
    available = true
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgzf-test-'))
  })

  afterAll(() => {
    if (tmpdir) {fs.rmSync(tmpdir, { recursive: true, force: true })}
  })

  function bgzipFile(name: string, contents: Uint8Array | string) {
    const raw = path.join(tmpdir, name)
    fs.writeFileSync(raw, contents)
    const r = spawnSync('bgzip', ['-i', '-f', raw])
    if (r.status !== 0) {throw new Error(`bgzip failed: ${r.stderr}`)}
    return { raw, gz: `${raw}.gz`, gzi: `${raw}.gz.gzi` }
  }

  // Deterministic binary content: byte i = i % 256, length chosen to span
  // multiple BGZF blocks (each block holds up to ~64 KiB uncompressed)
  function makeBlob(length: number) {
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) {out[i] = i % 256}
    return out
  }

  test.runIf(() => available)(
    'fresh multi-block file: read last byte without stat',
    async () => {
      if (!available) {return}
      const total = 500_000 // ~8 BGZF blocks
      const truth = makeBlob(total)
      const fx = bgzipFile('multiblock.bin', truth)

      const watcher = new StatWatcher(new LocalFile(fx.gz))
      const f = makeBgzf(watcher, fx.gzi)

      // read the final byte alone — exercises the trailing-block over-read
      const last = await f.read(1, total - 1)
      expect(last.length).toBe(1)
      expect(last[0]).toBe((total - 1) % 256)

      // and a range that straddles the last two blocks
      const tail = await f.read(20000, total - 20000)
      expect(tail.length).toBe(20000)
      expect([...tail]).toEqual([...truth.subarray(total - 20000)])

      expect(watcher.statCalls).toBe(0)
    },
  )

  test.runIf(() => available)(
    'fresh file sized at exact 64 KiB boundary: trailing read is correct',
    async () => {
      if (!available) {return}
      const total = 65536 // exactly one BGZF uncompressed block worth
      const truth = makeBlob(total)
      const fx = bgzipFile('boundary.bin', truth)

      const watcher = new StatWatcher(new LocalFile(fx.gz))
      const f = makeBgzf(watcher, fx.gzi)

      const buf = await f.read(total, 0)
      expect(buf.length).toBe(total)
      expect([...buf]).toEqual([...truth])
      expect(watcher.statCalls).toBe(0)
    },
  )

  test.runIf(() => available)(
    'fresh 1-byte file: trailing read of single byte works',
    async () => {
      if (!available) {return}
      const truth = new Uint8Array([0x42])
      const fx = bgzipFile('tiny.bin', truth)

      const watcher = new StatWatcher(new LocalFile(fx.gz))
      const f = makeBgzf(watcher, fx.gzi)

      const buf = await f.read(1, 0)
      expect(buf.length).toBe(1)
      expect(buf[0]).toBe(0x42)
      expect(watcher.statCalls).toBe(0)
    },
  )
})
