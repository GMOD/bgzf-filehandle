const path = require('path')

module.exports = {
  mode: 'production',
  entry: path.resolve(__dirname, 'src/worker-entry.js'),
  output: {
    // NOT ../src/wasm, where this used to land. Everything under src/ is a tsc
    // input, so this intermediate was compiled into esm/ and dist/ as well and
    // published three times over with two sourcemaps — ~190 KB of a file
    // nothing imports. Only the string module inline-worker.sh derives from it
    // is real, and that one does belong in src/wasm and in git.
    path: path.resolve(__dirname, '../build/worker'),
    filename: 'bgzf-worker-inlined.js',
    iife: true,
  },
  experiments: {
    topLevelAwait: true,
  },
  module: {
    rules: [
      {
        test: /\.wasm$/,
        type: 'asset/inline',
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.wasm'],
  },
  optimization: {
    minimize: false,
  },
}
