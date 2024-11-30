import fs from 'fs'
import { describe, it, expect } from 'vitest'
import { pakoUnzip, nodeUnzip, unzipChunk, unzipChunkSlice } from '../src/unzip'

describe('unzip', () => {
  it('can unzip bgzip-1.txt.gz', async () => {
    const testData = fs.readFileSync(require.resolve('./data/bgzip-1.txt.gz'))
    const fromPako = await pakoUnzip(testData)
    const fromNode = (await nodeUnzip(testData)) as Buffer
    expect(fromNode).toEqual(fromPako)
    expect(fromNode.length).toEqual(65569)
    expect(fromPako.length).toEqual(65569)
  })

  it('test error message modification', async () => {
    const testData = fs.readFileSync(require.resolve('./data/bgzip-1.txt.gz'))

    await expect(pakoUnzip(testData.slice(2))).rejects.toThrow(
      /problem decompressing block/,
    )
  })
})

describe('unzipChunk', () => {
  it('can unzip bgzip-1.txt.gz', async () => {
    const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
    const { dpositions, cpositions } = await unzipChunk(testData)
    expect(dpositions).toMatchSnapshot()
    expect(cpositions).toMatchSnapshot()
  })
  it('test error message modification', async () => {
    const testData = fs.readFileSync(require.resolve('./data/paired.bam'))

    await expect(unzipChunk(testData.slice(2))).rejects.toThrow(
      /problem decompressing block/,
    )
  })
})

describe('unzipChunkSlice', () => {
  it('can unzip bgzip-1.txt.gz', async () => {
    const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
    const { dpositions, cpositions } = await unzipChunkSlice(testData, {
      minv: { dataPosition: 0, blockPosition: 0 },
      maxv: { dataPosition: 100, blockPosition: 0 },
    })
    expect(dpositions).toMatchSnapshot()
    expect(cpositions).toMatchSnapshot()
  })
  it('can unzip bgzip-1.txt.gz positive minv.dataPosition', async () => {
    const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
    const { dpositions, cpositions } = await unzipChunkSlice(testData, {
      minv: { dataPosition: 50, blockPosition: 0 },
      maxv: { dataPosition: 100, blockPosition: 0 },
    })
    expect(dpositions).toMatchSnapshot()
    expect(cpositions).toMatchSnapshot()
  })
  it('can unzip bgzip-1.txt.gz positive maxv.blockPosition', async () => {
    const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
    const { dpositions, cpositions } = await unzipChunkSlice(testData, {
      minv: { dataPosition: 50, blockPosition: 0 },
      maxv: { dataPosition: 100, blockPosition: 1 },
    })
    expect(dpositions).toMatchSnapshot()
    expect(cpositions).toMatchSnapshot()
  })

  it('test error message modification', async () => {
    const testData = fs.readFileSync(require.resolve('./data/paired.bam'))
    await expect(
      unzipChunkSlice(testData.slice(2), {
        minv: { dataPosition: 40, blockPosition: 0 },
        maxv: { dataPosition: 100, blockPosition: 0 },
      }),
    ).rejects.toThrow(/problem decompressing block/)
  })
})
