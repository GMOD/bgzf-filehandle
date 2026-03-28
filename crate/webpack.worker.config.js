const path = require('path')

module.exports = {
  mode: 'production',
  entry: path.resolve(__dirname, 'src/worker-entry.js'),
  output: {
    path: path.resolve(__dirname, '../src/wasm'),
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
