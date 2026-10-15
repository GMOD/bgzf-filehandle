## [6.8.0](https://github.com/GMOD/bgzf-filehandle/compare/v6.7.0...v6.8.0) (2026-10-15)

### Chores

- Keep wasm-bindgen output out of src/ ([6be3c6a](https://github.com/GMOD/bgzf-filehandle/commit/6be3c6aea941480cb55892a582eea8e942870d01))
- Fail when the committed wasm bundles are stale ([3d49e62](https://github.com/GMOD/bgzf-filehandle/commit/3d49e62e594e71b074199ad268737faca5824215))

### Documentation

- Plainer README wording ([963faba](https://github.com/GMOD/bgzf-filehandle/commit/963fabaa31cd4f7ee18c858a1a13d135cfee9a9c))
- Break up README walls of text ([fa526bb](https://github.com/GMOD/bgzf-filehandle/commit/fa526bbfd0147520383ce317772905f988016525))

### Other Changes

- Reorganize agent-docs: ADRs folder, CLAUDE.md ([592ed76](https://github.com/GMOD/bgzf-filehandle/commit/592ed76ea0345039ea7f7bebff3b84d1c7f5afdd))
- Point docs at architecture-decision-records ([b182c8b](https://github.com/GMOD/bgzf-filehandle/commit/b182c8b42478fa0e58d86d286447e0a8dd566da5))
- Rewrite AI-writing tropes in README and docs ([7c2f32f](https://github.com/GMOD/bgzf-filehandle/commit/7c2f32f7e4ad3ad1a0ac380f1f6357cdae53ce15))
- Restore claims changed by the tropes rewrite ([3d4d311](https://github.com/GMOD/bgzf-filehandle/commit/3d4d311784fadf89f6b9bad5caf03eba145d4d20))
- Point ADR links at agent-docs/architecture-decision-records ([dfeb0ac](https://github.com/GMOD/bgzf-filehandle/commit/dfeb0ac87d3ac6385ba7b2ee52133e06c5a13f5f))
- Fold short verdict sentences into their neighbours ([93d144b](https://github.com/GMOD/bgzf-filehandle/commit/93d144b081ab8ae3dff31b65f896b83a483442bb))
- Fix doc errors found in the tropes audit ([bc96c87](https://github.com/GMOD/bgzf-filehandle/commit/bc96c8742ea2e7a4c5fc99bc5fb593e303634f92))
- Restore wording the tropes rewrite changed without a trope ([1d9e670](https://github.com/GMOD/bgzf-filehandle/commit/1d9e670489ec1fafaae6017d17de0d994fc4e292))
- State the finding in the consumers heading, and fix what each reader caches ([d9a38ea](https://github.com/GMOD/bgzf-filehandle/commit/d9a38eae9b82195abb24718d0a5bd7960203cb60))
- Trim wordiness in README and docs ([28b830d](https://github.com/GMOD/bgzf-filehandle/commit/28b830d3fb9a967a70989c5048a28059c1e49da2))
- Shorten README; leave details to docs/ ([31b8a28](https://github.com/GMOD/bgzf-filehandle/commit/31b8a2883afb35dfc0187115d2711b695970b414))
- Move Terms from README into docs/optimizations.md ([ddb1929](https://github.com/GMOD/bgzf-filehandle/commit/ddb1929e9cbb2adaaa945ad9990ac89015e8a17c))
- Fold worker pool into unzipChunkSlice section of README ([be29243](https://github.com/GMOD/bgzf-filehandle/commit/be2924314cbc1628cc70c912db180f66f719c37b))
- Report wasm load failures and traps as worker failures ([9d339ee](https://github.com/GMOD/bgzf-filehandle/commit/9d339ee2a0c67024d3a6a9331bdbe3ad76b59f73))
- Fall back to the client's thread when a pool host goes away ([b273396](https://github.com/GMOD/bgzf-filehandle/commit/b2733969c793f258843eab6d3d896e6a808e1d0c))
- Close the client's port once its host is gone, and thin comments ([965ead4](https://github.com/GMOD/bgzf-filehandle/commit/965ead4340918c4e0188355ed9b0f8ea375f2f56))
- Mark ADR 0001 superseded by 5b4ab22 ([94fdd49](https://github.com/GMOD/bgzf-filehandle/commit/94fdd4971a9bde20080acaf7f618854001d81a0d))
- Drop the pool's unused timing breakdown ([ef6ff8b](https://github.com/GMOD/bgzf-filehandle/commit/ef6ff8b4d2aa032d806b011cb6407e582f090bc8))
- Add unzipChunkSegments, which skips the pool's final copy ([31719e9](https://github.com/GMOD/bgzf-filehandle/commit/31719e9fcf8277563b71feac629d353e9a73d0e9))

### Styling

- Prettier on agent-docs/CLAUDE.md and docs/optimizations.md ([3f376f3](https://github.com/GMOD/bgzf-filehandle/commit/3f376f3d9d97b07ce69939299bfe7a4e9921980f))

## [6.7.0](https://github.com/GMOD/bgzf-filehandle/compare/v6.6.0...v6.7.0) (2026-09-21)

### Bug Fixes

- A pool whose workers fail never hangs a read, and small chunks never boot one ([644520c](https://github.com/GMOD/bgzf-filehandle/commit/644520c78f5a641a90cd4ec2d3351c38341cff44))

### Chores

- Keep agent worktrees out of the toolchain's way ([c22643d](https://github.com/GMOD/bgzf-filehandle/commit/c22643dd4638921d63ed5413e0e83545dfeb2f34))
- Build each ref in a worktree, with pnpm ([6f93d2c](https://github.com/GMOD/bgzf-filehandle/commit/6f93d2c3d6bd7443c99ee2e4b081f407e762bd4a))
- Install each ref with --frozen-lockfile ([2542de7](https://github.com/GMOD/bgzf-filehandle/commit/2542de79c36b0074fab15d3df8911404ab40366f))

### Documentation

- Tighten the README ([4344324](https://github.com/GMOD/bgzf-filehandle/commit/4344324b3968502f1bd568598710e138c89bf914))
- Link the build badge, document scanBgzfBlocks, move benches to CONTRIBUTING ([a8b323b](https://github.com/GMOD/bgzf-filehandle/commit/a8b323b7d9a90587f0a05f20ae7f249b4087f9ab))
- Say which benchmark needs pnpm bench, and why ([b07fe04](https://github.com/GMOD/bgzf-filehandle/commit/b07fe0460e460a29c18f0de702cbc977050379e6))
- Explain what libdeflate is and why, with a pako benchmark ([55c1e96](https://github.com/GMOD/bgzf-filehandle/commit/55c1e964c20a9984692650d6ee638745575a0b47))
- Restructure worker-pool.md for readability ([79f4b1e](https://github.com/GMOD/bgzf-filehandle/commit/79f4b1eb87e3a325a0eaca4c821dfc3782358a7b))
- Note the pako fallback, and document local.bench.ts ([8995426](https://github.com/GMOD/bgzf-filehandle/commit/8995426cc57489272d9e0ae5a2b42fa982d5b8c5))
- Say blockConcurrency counts requests, not threads ([61e7149](https://github.com/GMOD/bgzf-filehandle/commit/61e7149d1bb98b937c4ffa6a8bfe3afd61bbfb6c))
- Add optimizations.md, and say what the 70-90% is a share of ([e594cae](https://github.com/GMOD/bgzf-filehandle/commit/e594cae1532b4eff0d73ad1f85b3ae0c28b1ccd3))
- Name transferables where the pool is described, and tighten ([4de9218](https://github.com/GMOD/bgzf-filehandle/commit/4de921833fb1fcedf0feae741525a29280e788f4))
- Simplify README, link MDN transferables ([2a52985](https://github.com/GMOD/bgzf-filehandle/commit/2a529850e9a82a13a998248aeb76f8f79a27b3b4))
- Restructure optimizations.md, link libdeflate ([213bbb8](https://github.com/GMOD/bgzf-filehandle/commit/213bbb8eb5769fd4d6d6b9fc10eecd3bcb52888c))
- Cut worker-pool duplication, stamp the bench table, note the over-read ([53248e9](https://github.com/GMOD/bgzf-filehandle/commit/53248e9e6e11bb05b859b734317f98399447cc5a))
- Answer "why not DecompressionStream" with a measured bench arm ([1a909d8](https://github.com/GMOD/bgzf-filehandle/commit/1a909d825e24e00508b68dcce956010867ecebb2))
- Link bbi-js's crate, and correct the sibling DecompressionStream numbers ([0e8c501](https://github.com/GMOD/bgzf-filehandle/commit/0e8c501486319a74f9897bd28057c6a645bc02bc))
- Measure the worker pool, and correct the speedup it claimed ([a538f1b](https://github.com/GMOD/bgzf-filehandle/commit/a538f1baa98865c76a4a42c0663e294248a774d9))
- Smooth the prose in optimizations.md ([00fafd6](https://github.com/GMOD/bgzf-filehandle/commit/00fafd6b2cdddd81d1631241fddd23ada2335bbe))
- Put optimizations.md in the active voice ([74e179a](https://github.com/GMOD/bgzf-filehandle/commit/74e179a9c4db5dbc13d1b932b8e878763d9110aa))
- Measure the pool against chunk size, and out where it saves seconds ([9c2843f](https://github.com/GMOD/bgzf-filehandle/commit/9c2843f8f346d9f307be5d220d179f43bd5dc6ab))
- Trim optimizations.md ([07b47d2](https://github.com/GMOD/bgzf-filehandle/commit/07b47d2ec72c33c22f0a724492d4e9e4ab146c73))
- Put the README and worker-pool doc in the active voice ([9dcabce](https://github.com/GMOD/bgzf-filehandle/commit/9dcabce9d13b63b11bcccde2beebbdbf48740afb))
- Sweep worker count at scale — four is not where the curve flattens ([0ad246c](https://github.com/GMOD/bgzf-filehandle/commit/0ad246c593a837156b59627144a40bc8d4fc648b))
- Describe the release gate CONTRIBUTING actually runs ([72cec4e](https://github.com/GMOD/bgzf-filehandle/commit/72cec4e805a1cacfbb66560b886fec5c1ce7a07e))
- Define chunk and BGZF block, and say which one 'block' means ([5dad6b6](https://github.com/GMOD/bgzf-filehandle/commit/5dad6b6cdebb35a154206e17c4df505e59341ce3))
- Export Chunk and VirtualOffset, and document what a block scan returns ([fc59398](https://github.com/GMOD/bgzf-filehandle/commit/fc5939845af2390fb8980b7458fddbaa2af5a884))
- Point remote readers at @gmod/range-cache-filehandle ([2d621aa](https://github.com/GMOD/bgzf-filehandle/commit/2d621aa8291851d53df0a42d2b290bf5b41a3605))
- Say it in full sentences ([0bd6b38](https://github.com/GMOD/bgzf-filehandle/commit/0bd6b38c4756bb21ce7e87aae8bfb21ed3c1ccff))
- Fix anti-AI prose tropes (changelog framing, cleft, Title Case heading, "So"/"Nothing" openers) ([c8aae25](https://github.com/GMOD/bgzf-filehandle/commit/c8aae255f4c6d30d0025e083b78082ac2b5191ca))
- Fix inanimate-subject agency and figures of speech, correct two claims ([99c53ae](https://github.com/GMOD/bgzf-filehandle/commit/99c53ae40fb501d8de553794cc45bfc5dcc41a59))

### Other Changes

- Pin the wasm-vs-JS inflate ratio, which nothing measured ([0b39859](https://github.com/GMOD/bgzf-filehandle/commit/0b3985985473132ac7b53a9b6e8a5ca450279962))
- Format ([3ca3438](https://github.com/GMOD/bgzf-filehandle/commit/3ca3438b6f4c3baabcc264940a1598dc6ea0b1c6))

## [6.6.0](https://github.com/GMOD/bgzf-filehandle/compare/v6.5.0...v6.6.0) (2026-08-12)

### Features

- Reap idle workers, keeping the pool object valid ([8dba074](https://github.com/GMOD/bgzf-filehandle/commit/8dba074b2cfe16fdec4cb838c9723343b0b1c62d))

## [6.5.0](https://github.com/GMOD/bgzf-filehandle/compare/v6.4.0...v6.5.0) (2026-08-12)

### Chores

- Render only the commit subject, and link the commit ([d99ee1a](https://github.com/GMOD/bgzf-filehandle/commit/d99ee1a904cf7bb71a38fffd7e6b375e44d5594f))
- Create a GitHub release for each published tag ([4ecebf3](https://github.com/GMOD/bgzf-filehandle/commit/4ecebf3fea272680b1cd449338286c4ec22ed07e))
- Enforce type strippability in tsconfig ([f127a6d](https://github.com/GMOD/bgzf-filehandle/commit/f127a6d65febabe5246839805e49ea6dcea3a559))
- Stop publishing the worker build's intermediates ([7902147](https://github.com/GMOD/bgzf-filehandle/commit/790214728b32993193d9b51607f0c1488ffe66f9))

### Documentation

- Move the worker pool detail into docs/worker-pool.md ([2a9ac2d](https://github.com/GMOD/bgzf-filehandle/commit/2a9ac2d6b7a1939d103b5dac84ca32637e42b0e6))

## [6.4.0](https://github.com/GMOD/bgzf-filehandle/compare/v6.3.3...v6.4.0) (2026-08-11)

### Other Changes

- Parallel BGZF decompression, on any page (supersedes #80/#81) (#82) ([c256b74](https://github.com/GMOD/bgzf-filehandle/commit/c256b7459953d5f18d6b8d42af43a0380d5b8877))

## [6.3.3](https://github.com/GMOD/bgzf-filehandle/compare/v6.3.2...v6.3.3) (2026-08-10)

### Bug Fixes

- Copy out of wasm memory before decoding strings

### Chores

- Drop eslint-plugin-unicorn
- Type-check the tests and enforce prettier, as @gmod/bam does
- Let npm publish stop auto-correcting repository.url
- Exempt our own packages from the release quarantine
- Bump pnpm/action-setup to v6.0.10
- Run the test suite as `pnpm test --run`
- Wasm-bindgen 0.2.122 -> 0.2.126, bundle rebuilt
- Gate preversion on format:check, as CI does
- Gate preversion on typecheck too, as CI does
- Converge package.json on the shape its siblings use

### Documentation

- Why getStringFromWasm0 must copy out of wasm memory

### Other Changes

- Revert "chore: converge package.json" — the CHANGELOG prettier step ([6a12391](https://github.com/GMOD/bgzf-filehandle/commit/6a123916338d9eadb7a8c2574c0d4ca2c2c4c32d))

## [6.3.2](https://github.com/GMOD/bgzf-filehandle/compare/v6.3.1...v6.3.2) (2026-08-04)

### Bug Fixes

- Annotate unzip()'s return type instead of inferring any

### Chores

- Share one eslint-plugin-unicorn opt-out list across the repos
- Drop redundant @typescript-eslint/{eslint-plugin,parser}
- Turn off unicorn/prefer-early-return across the repos
- Add git-cliff for changelog generation

### Documentation

- Fix unzipChunkSlice example and tighten README
- Backfill CHANGELOG.md from v1.5.5 through v6.3.1
- Mark breaking changes in the generated changelog

### Performance Improvements

- Hand back cpositions/dpositions as the Float64Arrays wasm produced

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
