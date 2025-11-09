import fs from 'fs'

import { LocalFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import { BgzfFilehandle } from '../src/index.ts'

async function testRead(basename: string, length: number, position: number) {
  const f = new BgzfFilehandle({
    filehandle: new LocalFile(require.resolve(`./data/${basename}.gz`)),
    gziFilehandle: new LocalFile(require.resolve(`./data/${basename}.gz.gzi`)),
  })

  const buf2 = Buffer.allocUnsafe(length)
  const buf = await f.read(length, position)
  const fd = fs.openSync(require.resolve(`./data/${basename}`), 'r')
  fs.readSync(fd, buf2, 0, length, position)
  expect(buf.length).toEqual(buf2.length)
  expect(Array.from(buf)).toEqual(Array.from(buf2))
}

test('can read gff3_with_syncs.gff3.gz 1', async () => {
  await testRead('gff3_with_syncs.gff3', 10, 0)
})
test('can read gff3_with_syncs.gff3.gz 2', async () => {
  await testRead('gff3_with_syncs.gff3', 10, 100)
})
test('can read gff3_with_syncs.gff3.gz 3', async () => {
  await testRead('gff3_with_syncs.gff3', 1000, 100)
})

test('can read gff3_with_syncs.gff3.gz 4', async () => {
  await testRead('gff3_with_syncs.gff3', 2500, 0)
})
test('can read gff3_with_syncs.gff3.gz 5', async () => {
  await testRead('gff3_with_syncs.gff3', 2545, 1)
})
test('can read T_ko.2bit 1', async () => {
  await testRead('T_ko.2bit', 10, 0)
})
test('can read T_ko.2bit 2', async () => {
  await testRead('T_ko.2bit', 10000, 20000)
})
test('can read T_ko.2bit 3', async () => {
  await testRead('T_ko.2bit', 10000, 1)
})
test('can read T_ko.2bit 4', async () => {
  await testRead('T_ko.2bit', 10, 0)
})
test('can read T_ko.2bit 5', async () => {
  await testRead('T_ko.2bit', 0, 1000000)
})
