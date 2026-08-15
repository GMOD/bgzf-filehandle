# @gmod/bgzf-filehandle

[![NPM version](https://img.shields.io/npm/v/@gmod/bgzf-filehandle.svg?style=flat-square)](https://npmjs.org/package/@gmod/bgzf-filehandle)
[![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/bgzf-filehandle/publish.yml?branch=main)](https://github.com/GMOD/bgzf-filehandle/actions/workflows/publish.yml)

Reads [block-gzipped (BGZF)](http://www.htslib.org/doc/bgzip.html) files, such
as those created by bgzip, using coordinates from the uncompressed file.
[@gmod/indexedfasta](https://github.com/GMOD/indexedfasta),
[@gmod/bam](https://github.com/GMOD/bam-js) and
[@gmod/tabix](https://github.com/GMOD/tabix-js) all read their BGZF through it.

Decompression runs on [libdeflate](https://github.com/ebiggers/libdeflate),
which gives up streaming for speed: it wants a whole input buffer and an output
size known in advance. That is exactly the shape of BGZF, where every block is
an independent gzip member recording its own uncompressed length, and it is why
htslib can be built against the same library for BAM and CRAM. On this repo's
test fixtures it inflates two to three times faster than pako — see
[Performance](#performance). It is compiled to WebAssembly and inlined in the
bundle as base64, so there is no `.wasm` file to serve.

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
already-compressed one. Blocks sit adjacent on disk, so everything a read
touches is fetched as one contiguous range and inflated in one call — a read
spanning 300 blocks is a single request. Past 32MB uncompressed the read splits
into batches of that size, and `blockConcurrency` caps how many are in flight.

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

## Performance

`pnpm benchonly inflate` decompresses the test fixtures three ways: the shipped
wasm path, pako block by block (the pure-JS route this package took through
v6.0.0), and node's native zlib block by block as a reference floor. All three
are asserted byte-identical before anything is timed. Mean milliseconds per
file, lower better:

| fixture                          | wasm libdeflate | pako | node zlib |
| -------------------------------- | --------------- | ---- | --------- |
| paired.bam (84KB)                | 1.3             | 3.8  | 1.7       |
| T_ko.2bit.gz (518KB)             | 4.8             | 9.4  | 2.6       |
| shortreads_300x.bam (5.1MB)      | 69              | 176  | 88        |
| chr22_nanopore_subset.bam (14MB) | 123             | 345  | 139       |

The wasm path stays in the same range as native zlib, ahead of it on the three
BAM fixtures and behind on the 2bit one, while running somewhere zlib is not an
option at all. Measured on Node 24 on one laptop, so treat the ratios as
indicative and rerun them on your own data.

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
