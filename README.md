# @gmod/bgzf-filehandle

[![NPM version](https://img.shields.io/npm/v/@gmod/bgzf-filehandle.svg?style=flat-square)](https://npmjs.org/package/@gmod/bgzf-filehandle)
[![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/bgzf-filehandle/publish.yml?branch=main)](https://github.com/GMOD/bgzf-filehandle/actions/workflows/publish.yml)

Reads [block-gzipped (BGZF)](http://www.htslib.org/doc/bgzip.html) files using
uncompressed coordinates. [@gmod/bam](https://github.com/GMOD/bam-js),
[@gmod/tabix](https://github.com/GMOD/tabix-js) and
[@gmod/indexedfasta](https://github.com/GMOD/indexedfasta) build on it.

- **In:** a bgzip file and its `.gzi` index, or a chunk from a BAI/TBI index
- **Out:** the decompressed bytes
- Inflates with [libdeflate](https://github.com/ebiggers/libdeflate) compiled to
  WebAssembly and inlined as base64, so there is no `.wasm` file to serve. On
  this repo's fixtures it runs 2-3x faster than pako
  ([benchmarks](docs/optimizations.md))

## Install

```sh
npm install @gmod/bgzf-filehandle
```

## Terms

- **BGZF block**: one gzip member of a bgzip file, at most 64KB compressed. A
  decoder can inflate it without the others. A bare "block" always means this,
  never a deflate block
- **Virtual offset**: `{blockPosition, dataPosition}`, a BGZF block's file
  offset plus a position in its decompressed bytes
- **Chunk**: `{minv, maxv}`, a range between two virtual offsets, as a BAM or
  tabix index returns them

## BgzfFilehandle

```typescript
import { BgzfFilehandle } from '@gmod/bgzf-filehandle'
import { LocalFile } from 'generic-filehandle2'

const f = new BgzfFilehandle({
  filehandle: new LocalFile('my_file.gz'),
  gziFilehandle: new LocalFile('my_file.gz.gzi'),
})

const data = await f.read(300, 0) // length, position
```

Create the index with `bgzip -i my_file`, or `bgzip -r my_file.gz` for an
existing file. For a remote file, wrap it in
[`@gmod/range-cache-filehandle`](https://github.com/GMOD/range-cache-filehandle).

## unzip

Decompresses a BGZF or plain gzip buffer:

```typescript
import { unzip } from '@gmod/bgzf-filehandle'

const decompressed = await unzip(compressedData)
```

## unzipChunkSlice

Decompresses a chunk and slices out its bytes:

```typescript
import { MAX_BGZF_BLOCK_SIZE, unzipChunkSlice } from '@gmod/bgzf-filehandle'

// read one max-size block past maxv, since nothing records that block's length
const compressedData = await filehandle.read(
  maxv.blockPosition + MAX_BGZF_BLOCK_SIZE - minv.blockPosition,
  minv.blockPosition,
)
const { buffer, cpositions, dpositions } = await unzipChunkSlice(
  compressedData,
  { minv, maxv },
)
```

`cpositions` and `dpositions` hold the block boundaries in compressed and
decompressed coordinates, for building feature IDs that stay stable across
chunks.

## Worker pool

Pass a pool to spread a chunk's blocks across Web Workers:

```typescript
import { getSharedWorkerPool, unzipChunkSlice } from '@gmod/bgzf-filehandle'

const pool = await getSharedWorkerPool() // undefined without Worker support
const result = await unzipChunkSlice(compressedData, chunk, pool)
```

- A multi-megabyte chunk decodes 1.1-2.0x faster with four workers
- Chunks under 0.4MB inflated stay on the calling thread, as does everything
  while the workers boot, so a read never waits on a worker
- No cross-origin isolation is needed

[docs/worker-pool.md](docs/worker-pool.md) covers sizing, lifecycle and
measurements.

## Docs

- [docs/optimizations.md](docs/optimizations.md): benchmarks, including
  [why not `DecompressionStream`](docs/optimizations.md#why-not-decompressionstream-for-everything)
- [docs/worker-pool.md](docs/worker-pool.md): the worker pool
- [CONTRIBUTING.md](CONTRIBUTING.md): development and releases

## Academic use

Written with [NHGRI](http://genome.gov) funding as part of
[JBrowse](http://jbrowse.org). If you use this in a publication, please cite the
most recent JBrowse paper at [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels),
[Colin Diesh](https://github.com/cmdcolin)
