# @gmod/bgzf-filehandle

[![NPM version](https://img.shields.io/npm/v/@gmod/bgzf-filehandle.svg?style=flat-square)](https://npmjs.org/package/@gmod/bgzf-filehandle)
[![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/bgzf-filehandle/publish.yml?branch=main)](https://github.com/GMOD/bgzf-filehandle/actions/workflows/publish.yml)

Reads [block-gzipped (BGZF)](http://www.htslib.org/doc/bgzip.html) files, such
as those created by bgzip, using coordinates from the uncompressed file.
[@gmod/indexedfasta](https://github.com/GMOD/indexedfasta),
[@gmod/bam](https://github.com/GMOD/bam-js) and
[@gmod/tabix](https://github.com/GMOD/tabix-js) all read their BGZF through it.

Decompression runs on [libdeflate](https://github.com/ebiggers/libdeflate),
compiled to WebAssembly and inlined in the bundle as base64, so there is no
`.wasm` file to serve. On this repo's fixtures it inflates two to three times
faster than pako, and about twice as fast as the browser's own
`DecompressionStream` — tables and reasoning, including
[why not just use `DecompressionStream`](docs/optimizations.md#why-not-decompressionstream-for-everything),
in [docs/optimizations.md](docs/optimizations.md).

## Terms

The docs here lean on three words, and two of them mean something narrower than
they sound:

- **BGZF block** — bgzip files are so called 'multi-member gzip files',
  basically indepently compressed gzip blocks that are concatenated together.
  https://www.htslib.org/doc/bgzip.html they are at most 64KB compressed, its
  trailer recording its own uncompressed length. Blocks decode independently of
  each other, which is what buys both random access and the worker pool. A bare
  "block" always means this one, never a deflate block.
- **Virtual offset** — `{blockPosition, dataPosition}`: which BGZF block, and
  how far into that block's decompressed bytes.
- **Chunk** — a range between two virtual offsets, `{minv, maxv}`, which is what
  a BAM or tabix index resolves a query to. A chunk covers a run of consecutive
  BGZF blocks and usually starts and ends partway through the first and last of
  them.

## Install

```sh
npm install @gmod/bgzf-filehandle
```

## BgzfFilehandle

Read a bgzip-compressed file with a `.gzi` index as though it never was:

```typescript
import { BgzfFilehandle } from '@gmod/bgzf-filehandle'
import { LocalFile } from 'generic-filehandle2'

const f = new BgzfFilehandle({
  filehandle: new LocalFile('path/to/my_file.gz'),
  gziFilehandle: new LocalFile('path/to/my_file.gz.gzi'),
  blockConcurrency: 10, // concurrent range requests per read, default 10
})

// read(length, position) — matches generic-filehandle2
const data: Uint8Array = await f.read(300, 0)
```

Create the index with `bgzip -i my_file`, or `bgzip -r my_file.gz` for an
already-compressed one. Everything a read touches arrives as one contiguous
range and inflates in one call.

## unzip

Decompress a BGZF or plain gzip buffer, falling back to plain gzip if the input
is not BGZF:

```typescript
import { unzip } from '@gmod/bgzf-filehandle'

const decompressed: Uint8Array = await unzip(compressedData)
```

## unzipChunkSlice

Decompress a range of BGZF blocks and slice out a virtual offset range — what
BAM and tabix readers do with a chunk from a BAI/TBI:

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
Web Workers — close to linear to about four workers. Bytes cross as
[transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
rather than copies, so the handoff costs the same whatever the size and needs no
cross-origin isolation:

```typescript
import { getSharedWorkerPool, unzipChunkSlice } from '@gmod/bgzf-filehandle'

const pool = await getSharedWorkerPool() // undefined if Workers are unavailable
const result = await unzipChunkSlice(compressedData, chunk, pool)
```

Safe to pass unconditionally — `undefined` keeps the sequential wasm path, and
readers that take a pool of their own (`@gmod/bam`'s `bgzfWorkerPool`) accept
the same value. Worker counts, cross-thread sharing, lifecycle and driving a
pool directly: [docs/worker-pool.md](docs/worker-pool.md).

## Docs

- [docs/optimizations.md](docs/optimizations.md) — benchmark numbers, and what
  we measured, kept and rejected
- [docs/worker-pool.md](docs/worker-pool.md) — pool lifecycle, sizing, sharing,
  and `scanBgzfBlocks`
- [CONTRIBUTING.md](CONTRIBUTING.md) — development and release steps

## Academic Use

This package was written with funding from the [NHGRI](http://genome.gov) as
part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic
project that you publish, please cite the most recent JBrowse paper, which will
be linked from [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels),
[Colin Diesh](https://github.com/cmdcolin)
