# Contributing

## Development

```sh
pnpm install
pnpm test
pnpm build
```

## Benchmarks

`pnpm benchonly <name>` runs one file from `benchmarks/`. Two of them import
`src/` directly, so they need no build: `inflate.bench.ts` measures the wasm
path against pako and native zlib, and `local.bench.ts` measures the layers
above inflate — `unzipChunkSlice`, `BgzfFilehandle.read`, and the plain-gzip
fallback.

`unzip.bench.ts` instead compares two refs, so it needs `pnpm bench` — that
builds each into `esm_branch1/`/`esm_branch2/` first (`origin/main` and the
current HEAD by default, or `BRANCH1`/`BRANCH2` to pick). Each ref is built as
committed, in a throwaway worktree, so uncommitted work is not measured.

## Releasing

Use `pnpm version patch/minor/major` — it runs lint, format, types, tests, build
and `test:pack`, regenerates CHANGELOG.md with git-cliff, then pushes the
version tag, which triggers the publish workflow.

That workflow publishes via npm trusted publishing (OIDC, no stored token),
which requires `--provenance` and `id-token: write` permissions.

This repo is already configured. To set up a new package:
`npm trust github <pkg> --file publish.yml --repo GMOD/<repo>` (requires
npm >=11.10.0 and 2FA).

Once npm publish succeeds, the `release` job creates the GitHub release for the
tag, taking its notes from that version's CHANGELOG.md section — which
`scripts/release-notes.sh` extracts, so run that with a version to preview what
a release will say.
