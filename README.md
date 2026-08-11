[![NPM version](https://img.shields.io/npm/v/@gmod/bgzf-filehandle.svg?style=flat-square)](https://npmjs.org/package/@gmod/bgzf-filehandle)
[![Coverage Status](https://img.shields.io/codecov/c/github/GMOD/bgzf-filehandle/master.svg?style=flat-square)](https://codecov.io/gh/GMOD/bgzf-filehandle/branch/master)
[![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/bgzf-filehandle/push.yml?branch=master)](https://github.com/GMOD/bgzf-filehandle/actions)

Transparently read
[indexed block-gzipped (BGZF)](http://www.htslib.org/doc/bgzip.html) files, such
as those created by bgzip, using coordinates from the uncompressed file. The
module is used in @gmod/indexedfasta to read bgzip-indexed fasta files (with gzi
index, fai index, and fa).

Uses WASM (libdeflate) for decompression.

## Install

    $ npm install --save @gmod/bgzf-filehandle

## Usage

### BgzfFilehandle

Read from a bgzip-compressed file with a `.gzi` index as if it were
uncompressed:

```typescript
import { BgzfFilehandle } from '@gmod/bgzf-filehandle'
import { LocalFile } from 'generic-filehandle2'

const f = new BgzfFilehandle({
  filehandle: new LocalFile('path/to/my_file.gz'),
  gziFilehandle: new LocalFile('path/to/my_file.gz.gzi'),
})

const data = await f.read(300, 0) // read(length, position) => Uint8Array
```

### unzip

Decompress an entire BGZF-compressed buffer. Also handles plain gzip:

```typescript
import { unzip } from '@gmod/bgzf-filehandle'

const decompressed = await unzip(compressedData)
```

### unzipChunkSlice

Decompress a range of BGZF blocks and slice out a virtual file offset range
(used by BAM/tabix readers with BAI/TBI indices):

```typescript
import { unzipChunkSlice } from '@gmod/bgzf-filehandle'

const { buffer, cpositions, dpositions } = await unzipChunkSlice(
  compressedData,
  chunk, // { minv: { blockPosition, dataPosition }, maxv: { blockPosition, dataPosition } }
)
```

The returned `cpositions` and `dpositions` give the block boundaries in
compressed and decompressed coordinates, which can be used for generating stable
feature IDs across chunk boundaries.

### Parallel decompression (optional)

`unzipChunkSlice` accepts an optional worker pool that spreads a chunk's BGZF
blocks across Web Workers. BGZF blocks are independently inflatable, so this
scales close to linearly up to about four workers.

**No cross-origin isolation is required.** Each worker's range is transferred to
it as an `ArrayBuffer` — a zero-copy move — so the pool works on an ordinary
page. A `SharedArrayBuffer` is used instead, with no per-worker slice at all,
only when the caller already hands one in.

The recommended pattern uses `getSharedWorkerPool`, which resolves to
`undefined` only where Workers cannot be created at all (node, say), so the same
call site works everywhere and falls back to the sequential wasm path when there
is no pool:

```typescript
import { getSharedWorkerPool, unzipChunkSlice } from '@gmod/bgzf-filehandle'

const pool = await getSharedWorkerPool() // undefined if workers are unavailable
const result = await unzipChunkSlice(compressedData, chunk, pool)
```

For more control (e.g. picking the worker count or owning the lifecycle),
`createBgzfWorkerPool(numWorkers)` returns a pool directly.

Note that manufacturing a `SharedArrayBuffer` to reach the shared path is not
worth it, and this package deliberately does not: `decompressAll` copies its
input into the wasm heap either way, so shared memory removes the host-side
slice rather than the boundary copy. Measured head to head in Chrome, copying a
`Uint8Array` into a fresh SAB was _slower_ than transferring. Shared memory only
pays when the compressed bytes are already in it.

## Academic Use

This package was written with funding from the [NHGRI](http://genome.gov) as
part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic
project that you publish, please cite the most recent JBrowse paper, which will
be linked from [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)
