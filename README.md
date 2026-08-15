# @gmod/bgzf-filehandle

[![NPM version](https://img.shields.io/npm/v/@gmod/bgzf-filehandle.svg?style=flat-square)](https://npmjs.org/package/@gmod/bgzf-filehandle)
[![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/bgzf-filehandle/publish.yml?branch=main)](https://github.com/GMOD/bgzf-filehandle/actions/workflows/publish.yml)

Reads [block-gzipped (BGZF)](http://www.htslib.org/doc/bgzip.html) files, such
as those created by bgzip, using coordinates from the uncompressed file.
Decompression is libdeflate compiled to WASM and inlined in the bundle, so there
is no `.wasm` file to serve. Used by
[@gmod/indexedfasta](https://github.com/GMOD/indexedfasta),
[@gmod/bam](https://github.com/GMOD/bam-js) and
[@gmod/tabix](https://github.com/GMOD/tabix-js).

## Install

```sh
npm install @gmod/bgzf-filehandle
```

## BgzfFilehandle

Read a bgzip-compressed file with a `.gzi` index as if it were uncompressed:

```typescript
import { BgzfFilehandle } from '@gmod/bgzf-filehandle'
import { LocalFile } from 'generic-filehandle2'

const f = new BgzfFilehandle({
  filehandle: new LocalFile('path/to/my_file.gz'),
  gziFilehandle: new LocalFile('path/to/my_file.gz.gzi'),
  blockConcurrency: 10, // in-flight batch reads (not threads), default 10
})

// read(length, position) — matches generic-filehandle2
const data: Uint8Array = await f.read(300, 0)
```

Create the index with `bgzip -i my_file`, or `bgzip -r my_file.gz` for an
already-compressed one. Blocks are adjacent on disk, so the blocks a read
touches are fetched as one contiguous range and inflated in one call — a read
spanning 300 blocks is one request. Past 32MB uncompressed the read splits into
batches of that size, and `blockConcurrency` caps how many are in flight.

## unzip

Decompress a BGZF or plain gzip buffer, falling back to plain gzip if the input
is not BGZF:

```typescript
import { unzip } from '@gmod/bgzf-filehandle'

const decompressed: Uint8Array = await unzip(compressedData)
```

## unzipChunkSlice

Decompress a range of blocks and slice out a virtual offset range — what BAM and
tabix readers do with a chunk from a BAI/TBI:

```typescript
import { MAX_BGZF_BLOCK_SIZE, unzipChunkSlice } from '@gmod/bgzf-filehandle'

const minv = { blockPosition: 1234, dataPosition: 56 }
const maxv = { blockPosition: 9876, dataPosition: 78 }

// input starts at minv.blockPosition and must run through the END of the block
// at maxv.blockPosition. That block's compressed length is recorded nowhere, so
// over-read by one maximum-size block to cover it
const compressedData = await filehandle.read(
  maxv.blockPosition + MAX_BGZF_BLOCK_SIZE - minv.blockPosition,
  minv.blockPosition,
)

const { buffer, cpositions, dpositions } = await unzipChunkSlice(
  compressedData,
  { minv, maxv },
)
```

`buffer` holds the decompressed bytes between the two offsets. `cpositions` and
`dpositions` are `Float64Array` block boundaries in compressed and decompressed
coordinates, for generating stable feature IDs across chunk boundaries.

## Worker pool

`unzipChunkSlice` takes an optional pool that spreads a chunk's blocks across
Web Workers — close to linear to about four workers, and no cross-origin
isolation required:

```typescript
import { getSharedWorkerPool, unzipChunkSlice } from '@gmod/bgzf-filehandle'

const pool = await getSharedWorkerPool() // undefined if Workers are unavailable
const result = await unzipChunkSlice(compressedData, chunk, pool)
```

Safe to pass unconditionally — `undefined` keeps the sequential wasm path, and
readers that take a pool of their own (`@gmod/bam`'s `bgzfWorkerPool`) accept
the same value. Worker counts, cross-thread sharing, lifecycle, driving a pool
directly with `scanBgzfBlocks`, and why `SharedArrayBuffer` is deliberately not
used: [docs/worker-pool.md](docs/worker-pool.md).

## Academic Use

This package was written with funding from the [NHGRI](http://genome.gov) as
part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic
project that you publish, please cite the most recent JBrowse paper, which will
be linked from [jbrowse.org](http://jbrowse.org).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and release steps.

## License

MIT © [Robert Buels](https://github.com/rbuels),
[Colin Diesh](https://github.com/cmdcolin)
