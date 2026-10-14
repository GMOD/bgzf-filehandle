import fs from 'node:fs'

import { expect, test } from 'vitest'

import { scanBgzfBlocks } from '../src/bgzfBlockScan.ts'
import { inflateHere } from '../src/inflateBlocks.ts'
import { concatUint8Array } from '../src/util.ts'
import { BgzfWorkerPoolClient } from '../src/workerPoolClient.ts'
import { BgzfWorkerPoolHost } from '../src/workerPoolHost.ts'

import type { BgzfWorkerPool } from '../src/workerPool.ts'

const input = new Uint8Array(
  fs.readFileSync(require.resolve('./data/paired.bam')),
)
const blocks = scanBgzfBlocks(input, 0, input.length)
const expected = Buffer.from(
  concatUint8Array((await inflateHere(input, blocks)).blocks),
)

/** a pool that inflates in process, or, with `hang`, never answers at all */
function stubPool(hang = false) {
  const calls = { count: 0 }
  const pool: BgzfWorkerPool = {
    decompressBlocks: (data, b) => {
      calls.count++
      return hang
        ? Promise.withResolvers<never>().promise
        : inflateHere(data, b)
    },
    destroy: () => undefined,
  }
  return { pool, calls }
}

function connect(pool: BgzfWorkerPool) {
  const host = new BgzfWorkerPoolHost(pool)
  const channel = new MessageChannel()
  host.connectPort(channel.port1)
  const client = new BgzfWorkerPoolClient(channel.port2)
  return { host, client, hostPort: channel.port1 }
}

async function expectInflated(client: BgzfWorkerPoolClient) {
  const result = await client.decompressBlocks(input, blocks)
  expect(Buffer.from(concatUint8Array(result.blocks)).equals(expected)).toBe(
    true,
  )
}

test('a client inflates through the host and leaves the caller its bytes', async () => {
  const { pool, calls } = stubPool()
  const { client } = connect(pool)
  await expectInflated(client)
  expect(calls.count).toBe(1)
  expect(input.byteLength).toBeGreaterThan(0)
  client.destroy()
})

test('a request in flight when the host is destroyed inflates on the client', async () => {
  const { pool } = stubPool(true)
  const { host, client } = connect(pool)
  const inFlight = expectInflated(client)
  host.destroy()
  await inFlight
  client.destroy()
})

test('a request in flight when the host disconnects the port inflates on the client', async () => {
  const { pool } = stubPool(true)
  const { host, client, hostPort } = connect(pool)
  const inFlight = expectInflated(client)
  host.disconnectPort(hostPort)
  await inFlight
  client.destroy()
})

test('a host port closed without a word still releases the client', async () => {
  const { pool } = stubPool(true)
  const { client, hostPort } = connect(pool)
  const inFlight = expectInflated(client)
  hostPort.close()
  await inFlight
  client.destroy()
})

test('once the host is gone, later calls inflate on the client', async () => {
  const { pool, calls } = stubPool()
  const { host, client } = connect(pool)
  host.destroy()
  await new Promise(resolve => setTimeout(resolve, 0))
  await expectInflated(client)
  expect(calls.count).toBe(0)
  client.destroy()
})

test('a destroyed client rejects rather than posting to a closed port', async () => {
  const { pool } = stubPool()
  const { client, host } = connect(pool)
  client.destroy()
  await expect(client.decompressBlocks(input, blocks)).rejects.toThrow(
    /destroyed/,
  )
  host.destroy()
})
