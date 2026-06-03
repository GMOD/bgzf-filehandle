[![NPM version](https://img.shields.io/npm/v/@gmod/bgzf-filehandle.svg?style=flat-square)](https://npmjs.org/package/@gmod/bgzf-filehandle)
[![Coverage Status](https://img.shields.io/codecov/c/github/GMOD/bgzf-filehandle/main.svg?style=flat-square)](https://codecov.io/gh/GMOD/bgzf-filehandle/branch/main)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/bgzf-filehandle/publish.yml?branch=main)

Reads [block-gzipped (BGZF)](http://www.htslib.org/doc/bgzip.html) files, such
as those created by bgzip, using coordinates from the uncompressed file.

Uses WASM (libdeflate) for decompression. Used by
[@gmod/indexedfasta](https://github.com/GMOD/indexedfasta) for bgzip-indexed
FASTA files with gzi index, and also [@gmod/bam](https://github.com/GMOD/bam-js)
and [@gmod/tabix](https://github.com/GMOD/tabix-js) for block decoding.

## Install

    $ npm install @gmod/bgzf-filehandle

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
  blockConcurrency: 10, // optional, default 10
})

// read(length, position) — matches generic-filehandle2 convention
const data: Uint8Array = await f.read(300, 0)
```

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
import { unzipChunkSlice } from '@gmod/bgzf-filehandle'

interface VirtualOffset {
  blockPosition: number
  dataPosition: number
}

const { buffer, cpositions, dpositions } = await unzipChunkSlice(
  compressedData,
  { minv: VirtualOffset, maxv: VirtualOffset },
)
```

The returned `cpositions` and `dpositions` give the block boundaries in
compressed and decompressed coordinates, useful for generating stable feature
IDs across chunk boundaries.

## Academic Use

This package was written with funding from the [NHGRI](http://genome.gov) as
part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic
project that you publish, please cite the most recent JBrowse paper, which will
be linked from [jbrowse.org](http://jbrowse.org).

## Publishing

[Trusted publishing](https://docs.npmjs.com/about-trusted-publishing) via GitHub
Actions.

```bash
pnpm version patch  # or minor/major
```

## License

MIT © [Robert Buels](https://github.com/rbuels)
