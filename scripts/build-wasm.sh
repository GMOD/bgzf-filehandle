#!/bin/bash
set -e

cd "$(dirname "$0")/../crate"

echo "Building WASM..."
cargo build --release --target wasm32-unknown-unknown

echo "Generating JS bindings..."
wasm-bindgen --target bundler --out-dir ../src/wasm target/wasm32-unknown-unknown/release/bgzf_wasm.wasm

echo "Bundling with webpack..."
cd ..
npx webpack --config crate/webpack.config.js

echo "Bundling worker with webpack..."
npx webpack --config crate/webpack.worker.config.js

echo "Inlining worker source..."
bash "$(dirname "$0")/inline-worker.sh"

echo "WASM build complete!"
