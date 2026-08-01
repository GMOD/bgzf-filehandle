# v6.3.1

- Declare `sideEffects` for the wasm bundle path so bundlers don't tree-shake it away
- Internal maintenance only otherwise: pin pnpm version, sha-pin CI actions, move CI to Node 24

# v6.3.0

- Coalesce adjacent BGZF block reads into a single contiguous read and decompress call instead of one read per block, capped at 32 MB uncompressed per batch
- Keep non-BGZF input out of the wasm heap by sniffing the BGZF header in JS before handing off to wasm, since the wasm heap only grows and never shrinks
- Store the gzi block index as packed typed arrays instead of an array of tuples, cutting memory use and GC pressure for large indexes
- Bump `generic-filehandle2` dependency

# v6.2.1

- Fix output buffer over-allocation: compute the exact uncompressed size from BGZF block trailers instead of guessing `input.len() * 4`, which could reserve hundreds of MB of unshrinkable wasm heap on deep-coverage regions
- Document `blockConcurrency` in the README as a cap on in-flight async reads, not threads

# v6.2.0

- Internal maintenance only, no functional change

# v6.1.0

- Speed up gzi index parsing by reading 64-bit offsets via a single shared `DataView` instead of allocating a `BigInt` per entry
- Drop the unused `@jbrowse/quick-lru` dependency
- Remove dead wasm-exported `decompress_block` function and its JS wrapper

# v6.0.27

- Drop the `stat()` call previously needed to size the trailing block read; over-read up to the max BGZF block size instead, removing a round trip per read

# v6.0.26

- Replace the `p-limit` dependency with a small built-in concurrency limiter — `p-limit` v7+ is pure ESM and broke downstream Jest/CJS consumers

# v6.0.25

- Avoid extra data copies from wasm: decompression results are now moved out of the Rust struct instead of cloned
- Remove unused `GziIndex.getLastBlock()`

# v6.0.24

- Read and decompress BGZF blocks concurrently in `BgzFilehandle.read`, bounded by a new `blockConcurrency` constructor option (default 10)
- Speed up gzi index parsing with a binary-search helper and `DataView`-based 64-bit reads

# v6.0.23

- Rename the inlined wasm bundle file from `.mjs` to `.js` (no consumer-visible change)

# v6.0.22

- Internal maintenance only, no functional change

# v6.0.21

- Internal maintenance only, no functional change

# v6.0.20

- Rename the inlined WASM bundle to `.mjs` so Node always parses it as ESM, fixing a `SyntaxError` when `require()`-ing the CJS `dist` build
- Add a `test:pack` smoke test that packs, installs, and imports the published package through both ESM and CJS entry points, catching wasm-bundle-missing/wrong-module-type bugs that `pnpm test` can't see
- Simplify the gzi-index binary search and read pipeline internally (no behavior change); drop the unused `_blockCache` parameter from `unzipChunkSlice`
- Bump wasm-bindgen to 0.2.121

# v6.0.19

- Fix a malformed `package.json` `exports` map (doubly-nested `import`/`require` conditions) that could break module resolution for consumers; add a `main` field for CJS backwards compatibility
- Enable `noUncheckedIndexedAccess` in the TypeScript build and add non-null assertions where needed
- Switch from `eslint-plugin-import` to `eslint-plugin-import-x`; bump eslint to v10
- Internal maintenance: standardize build scripts and tsconfig, README fixes

# v6.0.18

- Internal maintenance only, no functional change

# v6.0.17

- Internal maintenance only, no functional change (npm trusted-publishing/OIDC workflow fixes)

# v6.0.16

- Internal maintenance only, no functional change (npm trusted-publishing/OIDC workflow fixes)

# v6.0.15

- Internal maintenance only, no functional change (npm trusted-publishing/OIDC workflow fixes)

# v6.0.14

- Internal maintenance only, no functional change (publish workflow fix)

# v6.0.13

- Migrate to a pnpm workspace/monorepo layout; switch build scripts and CI from yarn to pnpm, bump CI to Node 24
- Switch module resolution to `nodenext` and es2022 target; publish via npm trusted publishing (OIDC) instead of a stored token
- Remove unused exported types (`BlockCache`, `Filehandle`, `DecompressedBlock`, `BlockInfo`) from the public API
- Bump TypeScript to v6 and other dependencies

# v6.0.12

- Fix `unzipChunkSlice`/`decompressChunkSlice` producing corrupted output for files or offsets beyond 4GB: block/data positions were being truncated to a 32-bit integer internally even after the v6.0.10 switch to `f64`

# v6.0.11

- No functional change (version bump only)

# v6.0.10

- Support files larger than 4GB: `decompressChunkSlice` now tracks block/data positions as `f64` instead of `u32`
- Bump dependencies (`generic-filehandle2`, TypeScript tooling, webpack)

# v6.0.9

- Remove the block-cache API added in v6.0.7: drops `ByteCache`, `decompressChunkCached`, `decompressSingleBlock`, `getBlockPositions`, and related type exports, plus the `quick-lru` dependency

# v6.0.8

- Narrow `decompressChunkCached`'s `opts` type from `Record<string, unknown>` to `{ signal?: AbortSignal }`

# v6.0.7

- Add back a block cache: new `ByteCache` (LRU-based, via `quick-lru`) plus `decompressChunkCached`, `decompressSingleBlock`, and `getBlockPositions`, exported from the package root
- Bump `generic-filehandle2` and dev dependencies (eslint, vitest, webpack)

# v6.0.6

- Disable webpack minification when building the inlined WASM bundle

# v6.0.5

- Add a pako-based fallback for gzip decompression in environments without `DecompressionStream`

# v6.0.4

- Support decompressing plain (non-bgzf) gzip input in `unzip()`, auto-detected by gzip header, via `DecompressionStream`

# v6.0.3

- Remove unused `pako-esm2` dependency

# v6.0.2

- Fix handling of truncated bgzf input at the end of a chunk: only throw an invalid-header error when the first block is malformed, otherwise stop cleanly instead of erroring on trailing partial data

# v6.0.1

- Switch block decompression to a WASM-compiled Rust libdeflate core, replacing the pako-based path, for significantly faster unzip and unzipChunkSlice

# v6.0.0

- Rewrite `unzip`/`unzipChunkSlice` on pako-esm2 v2's `MultiMemberGzip` API, replacing the manual `Inflate`/`Z_SYNC_FLUSH` loop
- Bump `pako-esm2` to v2

# v5.0.2

- Revert the raw-inflate/CRC-skip decompression from v5.0.0-v5.0.1 back to the previous pako-based path, restoring gzip CRC validation and the original error messages

# v5.0.1

- Fix incorrect buffer length/offset calculation in `unzipChunkSlice` introduced by the v5.0.0 raw-decompress rewrite

# v5.0.0

- BREAKING: `unzip` and `unzipChunkSlice` now decompress bgzip blocks by parsing gzip headers and inflating raw deflate data directly, skipping pako's CRC32 checks for speed; corrupted blocks are now only caught via an ISIZE length mismatch rather than a CRC failure
- Error messages on decompression failure changed shape (now wrap the cause instead of a fixed string)
- Bump devDependencies

# v4.2.1

- Simplify block cache key to just the compressed block position (previously mixed in a hash of the block's leading bytes)
- Pre-calculate decompressed output length to avoid a wasted allocation pass in `concatUint8Array`

# v4.2.0

- Replace `pako` with `pako-esm2`
- Bump devDependencies, including vitest 3 to 4 and eslint-plugin-unicorn

# v4.1.1

- Change `BlockCache` from a `Map` type alias to a minimal `get`/`set` interface, so consumers can pass in caches like LRU caches that aren't a literal `Map`

# v4.1.0

- Add optional block-level cache to `unzipChunkSlice` so repeated reads over overlapping bgzip chunks can reuse already-decompressed blocks
- Remove `unzipChunk` export; use `unzipChunkSlice` instead

# v4.0.0

- BREAKING: `BgzfFilehandle` and `GziIndex` constructors no longer accept `path`/`gziPath` string options or default to Node's `LocalFile`; callers must pass `filehandle`/`gziFilehandle` handle objects directly
- Bump generic-filehandle2 to ^2.0.5

# v3.0.5

- Add `postbuild:es5` step writing `dist/package.json` with `"type": "commonjs"`, fixing the CJS build output
- Remove `main` field from package.json now that `exports` covers resolution
- Change `preversion` (from `prepublishOnly`) to run tests and build before tagging a release
- Change `src/index.ts` to export named bindings from `unzip.ts` instead of `export *`

# v3.0.3

- Add back `main` field alongside `exports` for tooling that doesn't resolve conditional exports

# v3.0.2

- Fix pako import to work under CommonJS interop (named imports from `pako` broke `require()` consumers)

# v3.0.1

- Internal maintenance only, no functional change

# v3.0.0

- Breaking: package is now pure ESM (`"type": "module"`) with a conditional `exports` map for `esm/`/`dist/` builds; drops the old `main`/`module` fields
- Breaking: bump `generic-filehandle2` to v2
- Bump `@types/node`, `vitest`, and `eslint-plugin-unicorn` majors
- Note pako cannot be upgraded past v1 due to `Z_SYNC_FLUSH` removal in v2

# v2.0.4

- Drop the `longfn` dependency in favor of a small inlined 64-bit little-endian integer reader

# v2.0.3

- Breaking: remove `BgzfFilehandle.stat()`/`getUncompressedFileSize()`
- Replace `long` dependency with `longfn`
- Cache the gzi index promise and clear it on read failure so a failed read doesn't wedge the cache

# v2.0.2

- Bump `generic-filehandle2` to v1.0.0

# v2.0.1

- Breaking: remove `unzipChunk` and `nodeUnzip`/`pakoUnzip` exports; only `unzip` and `unzipChunkSlice` remain
- Bump `generic-filehandle2` patch version

# v2.0.0

- Breaking: `BgzfFilehandle.read()` now takes `(length, position)` and returns a `Uint8Array` directly instead of writing into a caller-supplied `Buffer`
- Breaking: switch from `generic-filehandle` to `generic-filehandle2`, dropping the `es6-promisify` dependency
- Internal buffers/APIs now use `Uint8Array` instead of Node `Buffer` throughout

# v1.5.5

- Downgrade TypeScript to ~5.6 to fix `Buffer` generic type errors for consumers

# v1.5.4

- Remove zlib import. It was only used for unzipping entire files on node.js
  specifically, and was unused in all contexts for e.g. block based decoding of
  BAM, so it is largely unused

# v1.4.6

- Add explicit 'buffer' import

# v1.4.5

- Bump generic-filehandle 2->3

# v1.4.4

- Publish src directory for better source maps

# 1.4.3

- Add optimization to avoid data copying during unzip operations

# 1.4.2

- Make nodeUnzip return `Promise<Buffer>`

# 1.4.1

- Add typescript and ESM build to module

# 1.4.0

- Use "browser" field in package.json to choose node vs pako-esm2 unzip

# v1.3.4

- Improve gzip error message

# v1.3.3

- Bugfix for unzipChunkSize

# v1.3.2

- Bugfix for unzipChunkSize

# v1.3.1

- Create unzipChunkSize

# v1.3.0

- Improved build system
- Create unzipChunk

# v1.2.3

- Fix babel runtime

# v1.2.2

- Change util.promisify->es6-promisify

# v1.2.1

- Fix pako-esm2 unzip in browser

# v1.2.0

- Add tests for unzip

# v1.1.0

- Initial nodejs package
- Work with bgzip indexed fasta files
