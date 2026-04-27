[![NPM version](https://img.shields.io/npm/v/@gmod/bgzf-filehandle.svg?style=flat-square)](https://npmjs.org/package/@gmod/bgzf-filehandle)
[![Coverage Status](https://img.shields.io/codecov/c/github/GMOD/bgzf-filehandle/main.svg?style=flat-square)](https://codecov.io/gh/GMOD/bgzf-filehandle/branch/main)
[![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/bgzf-filehandle/push.yml?branch=main)](https://github.com/GMOD/bgzf-filehandle/actions)

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

## Academic Use

This package was written with funding from the [NHGRI](http://genome.gov) as
part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic
project that you publish, please cite the most recent JBrowse paper, which will
be linked from [jbrowse.org](http://jbrowse.org).

## Publishing

Releases are published to npm automatically via GitHub Actions using [npm trusted publishing](https://docs.npmjs.com/generating-provenance-statements) (OIDC-based provenance), triggered on version tags.

## License

MIT © [Robert Buels](https://github.com/rbuels)
