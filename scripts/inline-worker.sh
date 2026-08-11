#!/bin/bash
set -e

# Resolve repo root from script location so this works no matter the cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WORKER_FILE="$ROOT_DIR/src/wasm/bgzf-worker-inlined.js"
OUTPUT_FILE="$ROOT_DIR/src/wasm/bgzf-worker-source.ts"

echo "Inlining worker source into TypeScript module..."

echo "// Auto-generated - do not edit. Run scripts/inline-worker.sh to regenerate." > "$OUTPUT_FILE"
echo "// eslint-disable-next-line" >> "$OUTPUT_FILE"
echo -n "export default " >> "$OUTPUT_FILE"
node -e "
const fs = require('fs');
const source = fs.readFileSync('$WORKER_FILE', 'utf8');
process.stdout.write(JSON.stringify(source));
" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "Worker source inlined into $OUTPUT_FILE"
