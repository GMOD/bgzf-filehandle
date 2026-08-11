# @gmod/bgzf-filehandle

[![NPM version](https://img.shields.io/npm/v/@gmod/bgzf-filehandle.svg?style=flat-square)](https://npmjs.org/package/@gmod/bgzf-filehandle)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/bgzf-filehandle/publish.yml?branch=main)

Reads [block-gzipped (BGZF)](http://www.htslib.org/doc/bgzip.html) files, such
as those created by bgzip, using coordinates from the uncompressed file.

Uses WASM (libdeflate) for decompression. Used by
[@gmod/indexedfasta](https://github.com/GMOD/indexedfasta) for bgzip-indexed
FASTA files with gzi index, and also [@gmod/bam](https://github.com/GMOD/bam-js)
and [@gmod/tabix](https://github.com/GMOD/tabix-js) for block decoding.

## Install

```sh
npm install @gmod/bgzf-filehandle
```

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
  blockConcurrency: 10, // max in-flight async batch reads (not threads), default 10
})

// read(length, position) — matches generic-filehandle2 convention
const data: Uint8Array = await f.read(300, 0)
```

The `.gzi` index maps uncompressed offsets to block starts; create one with
`bgzip -i my_file` (or `bgzip -r my_file.gz` for an already-compressed file).

BGZF blocks are adjacent in the file, so every block a read touches is fetched
as one contiguous range and decompressed in a single call — a read spanning 300
blocks is one request, not 300. Reads large enough to be split (over 32 MB
uncompressed) produce several batches, and `blockConcurrency` caps how many of
those are in flight at once.

### unzip

Decompress a BGZF or plain gzip buffer. Falls back to plain gzip automatically
if the input is not a valid BGZF stream:

```typescript
import { unzip } from '@gmod/bgzf-filehandle'

const decompressed: Uint8Array = await unzip(compressedData)
```

### unzipChunkSlice

Decompress a range of BGZF blocks and slice out a virtual file offset range
(used by BAM/tabix readers with BAI/TBI indices):

```typescript
import { MAX_BGZF_BLOCK_SIZE, unzipChunkSlice } from '@gmod/bgzf-filehandle'

const minv = { blockPosition: 1234, dataPosition: 56 }
const maxv = { blockPosition: 9876, dataPosition: 78 }

// input must be the bytes starting at minv.blockPosition, through the end of
// the block at maxv.blockPosition. That block's compressed length isn't
// recorded anywhere, so over-read by one maximum-size block to cover it
const compressedData = await filehandle.read(
  maxv.blockPosition + MAX_BGZF_BLOCK_SIZE - minv.blockPosition,
  minv.blockPosition,
)

const { buffer, cpositions, dpositions } = await unzipChunkSlice(
  compressedData,
  { minv, maxv },
)
```

`buffer` is a `Uint8Array` of the decompressed bytes between the two virtual
offsets. `cpositions` and `dpositions` are `Float64Array` block boundaries in
compressed (absolute file offset) and decompressed coordinates, useful for
generating stable feature IDs across chunk boundaries. They come back as the
typed arrays wasm produced — indexed reads and `.length` are all a consumer
needs, so they are not copied into plain arrays on the way out.

### Parallel decompression (optional)

`unzipChunkSlice` accepts an optional worker pool that spreads a chunk's BGZF
blocks across Web Workers. BGZF blocks are independently inflatable, so this
scales close to linearly up to about four workers.

**No cross-origin isolation is required.** Each worker's range is transferred to
it as an `ArrayBuffer` — a zero-copy move — so the pool works on an ordinary
page.

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

`SharedArrayBuffer` is deliberately not used. It was the original design and was
measured out: it needs COOP/COEP, which most installs cannot set, and it buys
nothing when they can — `decompressAll` copies its input into the wasm heap
either way, so shared memory removes the host-side slice rather than the
boundary copy. Head to head in Chrome at 4 workers, a pooled SAB was at parity
with transferring and a freshly allocated one was slower.

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
