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

`unzipChunkSlice` accepts an optional worker pool that parallelizes BGZF block
decompression across Web Workers using `SharedArrayBuffer` for zero-copy input
sharing. The pool is only usable in cross-origin-isolated browser contexts
(`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`).

The recommended pattern uses `getSharedWorkerPool`, which resolves to
`undefined` when `SharedArrayBuffer` is unavailable so the same call site works
in both isolated and non-isolated environments — non-isolated installs
transparently fall back to the sequential WASM path:

```typescript
import { getSharedWorkerPool, unzipChunkSlice } from '@gmod/bgzf-filehandle'

const pool = await getSharedWorkerPool() // undefined if SAB is unavailable
const result = await unzipChunkSlice(compressedData, chunk, pool)
```

For more control (e.g. picking the worker count or owning the lifecycle),
`createBgzfWorkerPool(numWorkers)` returns a pool directly and throws if SAB is
unavailable.

## Academic Use

This package was written with funding from the [NHGRI](http://genome.gov) as
part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic
project that you publish, please cite the most recent JBrowse paper, which will
be linked from [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)
