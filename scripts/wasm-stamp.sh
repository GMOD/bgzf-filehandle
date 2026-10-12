#!/usr/bin/env bash
# The wasm bundle's bytes depend on the build machine (libdeflate's C goes
# through the system clang), so a fresh build can't be compared with the
# committed bundles. Instead build:wasm records a hash of its inputs, crate/
# and inline-worker.sh, next to a hash of each bundle it produced, and the
# check fails when any of them has changed since.
#
#   wasm-stamp.sh write   record the hashes (build:wasm runs this)
#   wasm-stamp.sh check   fail unless they all still match
set -euo pipefail

cd "$(dirname "$0")/.."
STAMP=crate/wasm-inputs.sha256
BUNDLES=(src/wasm/bgzf-wasm-inlined.js src/wasm/bgzf-worker-source.ts)

current() {
  git ls-files -z --cached --others --exclude-standard -- crate scripts/inline-worker.sh ":(exclude)$STAMP" |
    LC_ALL=C sort -z |
    xargs -0 sha256sum |
    sha256sum |
    sed 's|-$|crate/ scripts/inline-worker.sh|'
  sha256sum "${BUNDLES[@]}"
}

case "${1:-}" in
  write)
    current >"$STAMP"
    ;;
  check)
    if ! diff <(current) "$STAMP" >/dev/null; then
      diff <(current) "$STAMP" >&2 || true
      echo "crate/, inline-worker.sh or a bundle in src/wasm changed since build:wasm last ran." >&2
      echo "Run pnpm build:wasm, then commit src/wasm and $STAMP." >&2
      exit 1
    fi
    echo "src/wasm was built from the current crate/"
    ;;
  *)
    echo "usage: $0 write|check" >&2
    exit 2
    ;;
esac
