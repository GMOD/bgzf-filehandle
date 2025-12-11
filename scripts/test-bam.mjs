import { readFileSync } from 'fs'
import { unzip, unzipChunkSlice } from '../src/index.ts'

const bamPath = process.argv[2] || '../bam-js/test/data/volvox-sorted.bam'

const data = readFileSync(bamPath)
console.log('File:', bamPath)
console.log('File size:', data.length)
console.log('Is Buffer:', Buffer.isBuffer(data))
console.log('Is Uint8Array:', data instanceof Uint8Array)
console.log('First 20 bytes:', [...data.slice(0, 20)].map(b => b.toString(16).padStart(2, '0')).join(' '))

console.log('\n--- Testing unzip with Buffer ---')
try {
  const result = await unzip(data)
  console.log('Success! Decompressed size:', result.length)
} catch (e) {
  console.error('Failed:', e.message)
}

console.log('\n--- Testing unzip with Uint8Array ---')
try {
  const arr = new Uint8Array(data)
  const result = await unzip(arr)
  console.log('Success! Decompressed size:', result.length)
} catch (e) {
  console.error('Failed:', e.message)
}

console.log('\n--- Testing unzipChunkSlice ---')
try {
  const chunk = {
    minv: { blockPosition: 0, dataPosition: 0 },
    maxv: { blockPosition: 1000, dataPosition: 100 },
  }
  const result = await unzipChunkSlice(data, chunk)
  console.log('Success! Buffer size:', result.buffer.length)
  console.log('cpositions:', result.cpositions)
  console.log('dpositions:', result.dpositions)
} catch (e) {
  console.error('Failed:', e.message)
}
