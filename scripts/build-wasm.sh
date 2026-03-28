#!/bin/bash
set -e

cd "$(dirname "$0")/../crate"

echo "Building WASM..."
cargo build --release --target wasm32-unknown-unknown

echo "Generating JS bindings..."
wasm-bindgen --target bundler --out-dir ../src/wasm target/wasm32-unknown-unknown/release/bgzf_wasm.wasm

echo "Bundling worker with esbuild..."
cd ..
npx esbuild crate/src/worker-entry.js --bundle --format=iife --outfile=src/wasm/bgzf-worker-bundle.js

echo "Inlining worker source..."
bash scripts/inline-worker.sh

echo "WASM build complete!"
