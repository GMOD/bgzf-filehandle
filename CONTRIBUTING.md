# Contributing

## Development

```sh
pnpm install
pnpm test
pnpm build
```

## The wasm bundles

- Git tracks the generated bundles in `src/wasm/`, so working on the TypeScript
  needs no Rust. `pnpm build:esm && pnpm build:es5` builds the JS alone;
  `pnpm build` starts with `build:wasm` and fails without the toolchain.
- `pnpm build:wasm` rebuilds them from `crate/`. It needs rustup, which installs
  the Rust release and wasm target that `crate/rust-toolchain.toml` pins, and a
  clang with a WebAssembly backend for libdeflate's C, which Apple's clang
  lacks. `crate/build-wasm.sh` installs `wasm-bindgen-cli` at the version in
  `Cargo.lock`.
- `build:wasm` also writes `crate/wasm-inputs.sha256`: a hash of `crate/` and
  `scripts/inline-worker.sh`, and a hash of each bundle. `pnpm check:wasm` runs
  first in CI and in `preversion`, and fails when any hash no longer matches, so
  a change to `crate/` can't land without its regenerated bundles.
- The check compares hashes rather than rebuilding, because the bundle bytes
  depend on the machine: clang-20 and clang-21 compile libdeflate to different
  wasm. The bundles CI builds for npm can therefore differ in bytes from the
  committed ones.

## Benchmarks

`pnpm benchonly <name>` runs one file from `benchmarks/`. Two of them import
`src/` directly, so they need no build: `inflate.bench.ts` measures the wasm
path against pako and native zlib, and `local.bench.ts` measures the layers
above inflate — `unzipChunkSlice`, `BgzfFilehandle.read`, and the plain-gzip
fallback.

`unzip.bench.ts` instead compares two refs, so it needs `pnpm bench`, which
first builds each ref into `esm_branch1/` and `esm_branch2/` (`origin/main` and
the current HEAD by default; set `BRANCH1`/`BRANCH2` to pick others). The script
builds each ref as committed, in a throwaway worktree, so it does not measure
uncommitted work.

## Releasing

Use `pnpm version patch/minor/major` — it runs `check:wasm`, lint, format,
types, tests, build and `test:pack`, regenerates CHANGELOG.md with git-cliff,
then pushes the version tag, which triggers the publish workflow.

The publish workflow uses npm trusted publishing (OIDC, no stored token), which
requires `--provenance` and `id-token: write` permissions.

Trusted publishing is already configured for this repo. To set up a new package:
`npm trust github <pkg> --file publish.yml --repo GMOD/<repo>` (requires
npm >=11.10.0 and 2FA).

Once npm publish succeeds, the `release` job creates the GitHub release for the
tag. `scripts/release-notes.sh` extracts the notes from that version's
CHANGELOG.md section; run it with a version to preview a release's notes.
