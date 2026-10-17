import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { rankVectors, registerMemoryRankRoute } = require('./memory-rank.cjs')
const express = require('express')

it('matches the existing dot-product score and stable ordering', () => {
    expect(rankVectors([1, 2], [[2, 3], [0, 1], [2, 3]])).toEqual([{ index: 0, score: 8 }, { index: 2, score: 8 }, { index: 1, score: 2 }])
})
it('rejects incompatible dimensions and nonfinite vectors', () => {
    expect(() => rankVectors([1], [[1, 2]])).toThrow()
    expect(() => rankVectors([NaN], [[1]])).toThrow()
})
it('ranks persisted vectors in a real worker and restricts cache access', async () => {
    const app = express(); app.use(express.json())
    const rows = new Map([
        ['cache/hypa-vector/a.json', Buffer.from(JSON.stringify({ value: { embedding: [1, 0] } }))],
        ['cache/hypa-vector/b.json', Buffer.from(JSON.stringify({ value: { embedding: [0, 1] } }))],
    ])
    registerMemoryRankRoute(app, { auth: async () => true, get: (key: string) => rows.get(key) })
    const server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    const request = (body: unknown) => fetch(`http://127.0.0.1:${server.address().port}/api/memory-rank`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) })
    try {
        const result = await request({ query: [0, 1], keys: [...rows.keys()] })
        expect(result.status).toBe(200)
        expect(await result.json()).toEqual({results: [{index:1,score:1},{index:0,score:0}]})
        expect((await request({query:[0,1],keys:['database/database.bin']})).status).toBe(400)
        expect((await request({query:[0,1],keys:['cache/hypa-vector/missing.json']})).status).toBe(409)
    } finally { await new Promise(resolve => server.close(resolve)) }
})
