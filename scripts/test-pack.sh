#!/usr/bin/env bash
# Smoke-test the published artifact: npm pack, install into a scratch dir,
# and import through both ESM and CJS entry points. The unzip module
# top-level-imports the wasm bundle, so a missing or wrong-module-type
# bundle fails at import — that's what we're guarding against.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

cd "$PKG_DIR"
TARBALL="$(npm pack --silent --pack-destination "$SCRATCH")"

# SYNC: @gmod/cram scripts/test-pack.sh, which grew these first after shipping
# the same two defects. What the tarball CONTAINS, before anything is installed
# from it: `pnpm test` runs against src/, so nothing else in the repo can see
# the package's shape. Both checks are for defects that shipped, not
# hypotheticals — 6.4.0 carried ~300 KB of them.
check_tarball_contents() {
  local listing
  listing="$(tar tzf "$SCRATCH/$TARBALL")"

  # (1) build intermediates. Only the wasm bundle and the worker source module
  # belong in wasm/. webpack's worker bundle goes to the gitignored build/ and
  # wasm-bindgen's glue and .wasm to crate/pkg/; under src/wasm, tsc would
  # publish each three times, as every release from 6.0.1 through 6.7.0 did.
  #
  # A whitelist, unlike cram-js's `-inlined` pattern: this repo ships
  # `bgzf-wasm-inlined.js` on purpose, and that pattern would reject it.
  local intermediates
  intermediates="$(grep '/wasm/' <<<"$listing" |
    grep -vE '/wasm/bgzf-(wasm-inlined|worker-source)\.' || true)"
  if [ -n "$intermediates" ]; then
    echo "error: build intermediates in the tarball's wasm/ dirs; they belong in build/ or crate/pkg/:" >&2
    echo "$intermediates" >&2
    return 1
  fi

  # (2) a declaration file that is really a bundle. Left to infer, tsc types the
  # inlined worker as the string *literal* and writes the whole bundle into the
  # .d.ts — 53 KB, twice. inline-worker.sh annotates the const to keep it at one
  # line. 32 KB is far above any hand-written declaration here.
  local big
  big="$(tar tzvf "$SCRATCH/$TARBALL" |
    awk '$NF ~ /\.d\.ts$/ && $3 > 32768 { print $3, $NF }')"
  if [ -n "$big" ]; then
    echo "error: oversized .d.ts in the tarball — a literal type of a bundle, not a declaration:" >&2
    echo "$big" >&2
    return 1
  fi
}
check_tarball_contents

cd "$SCRATCH"
cat >package.json <<'JSON'
{
  "name": "bgzf-pack-test",
  "version": "0.0.0",
  "private": true,
  "type": "module"
}
JSON
npm install --silent --no-audit --no-fund "./$TARBALL" >/dev/null

cat >smoke.mjs <<'JS'
import { BgzfFilehandle, unzip, unzipChunkSlice } from '@gmod/bgzf-filehandle'
for (const [name, fn] of Object.entries({ BgzfFilehandle, unzip, unzipChunkSlice })) {
  if (typeof fn !== 'function') throw new Error(`${name} missing from ESM entry`)
}
console.log('esm import ok')
JS

cat >smoke.cjs <<'JS'
const { BgzfFilehandle, unzip, unzipChunkSlice } = require('@gmod/bgzf-filehandle')
for (const [name, fn] of Object.entries({ BgzfFilehandle, unzip, unzipChunkSlice })) {
  if (typeof fn !== 'function') throw new Error(`${name} missing from CJS entry`)
}
console.log('cjs import ok')
JS

node smoke.mjs
node smoke.cjs
