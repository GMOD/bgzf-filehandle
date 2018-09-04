const fs = require('fs')
const { pakoUnzip, nodeUnzip } = require('../src/unzip')

describe('unzip', () => {
  it('can unzip bgzip-1.txt.gz', async () => {
    const testData = fs.readFileSync(require.resolve('./data/bgzip-1.txt.gz'))
    const fromPako = await pakoUnzip(testData)
    const fromNode = await nodeUnzip(testData)
    expect(fromNode).toEqual(fromPako)
    expect(fromNode.length).toEqual(65569)
    expect(fromPako.length).toEqual(65569)
  })
})
