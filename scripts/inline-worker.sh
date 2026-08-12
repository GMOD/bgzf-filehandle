#!/bin/bash
set -e

# Resolve repo root from script location so this works no matter the cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WORKER_FILE="$ROOT_DIR/build/worker/bgzf-worker-inlined.js"
OUTPUT_FILE="$ROOT_DIR/src/wasm/bgzf-worker-source.ts"

if [ ! -f "$WORKER_FILE" ]; then
  echo "error: $WORKER_FILE not found; run crate's build:worker-bundle first" >&2
  exit 1
fi

echo "Inlining worker source into TypeScript module..."

# The `: string` is load-bearing, not decoration. Left to infer, tsc types this
# as the string *literal* and writes the whole bundle out again into the .d.ts —
# 53 KB, in both esm/ and dist/, for every consumer's tsc to parse. Annotated,
# the declaration is one line.
echo "// Auto-generated - do not edit. Run scripts/inline-worker.sh to regenerate." > "$OUTPUT_FILE"
echo "// eslint-disable-next-line" >> "$OUTPUT_FILE"
echo -n "const workerSource: string = " >> "$OUTPUT_FILE"
node -e "
const fs = require('fs');
const source = fs.readFileSync('$WORKER_FILE', 'utf8');
process.stdout.write(JSON.stringify(source));
" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "export default workerSource" >> "$OUTPUT_FILE"

echo "Worker source inlined into $OUTPUT_FILE"
