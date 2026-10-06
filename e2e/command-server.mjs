#!/usr/bin/env node
// The stock commands for the Playwright tests (ADR-001): the real handler from
// functions/_lib/stockCommands.ts, loaded through Vite the way scripts/integrity-audit.mjs
// loads app code, over the Firestore EMULATOR (owner token) — never a real project.
// Vite's e2e mode proxies /api/stock here (vite.config.ts). Pages Functions themselves are
// not served by Vite, so this stands in for them, running the same function.
import { createServer as createHttp } from 'node:http'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const PORT = 5177
const PROJECT = 'demo-pzm-e2e'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
const { runStockCommand } = await vite.ssrLoadModule('/functions/_lib/stockCommands.ts')
const { restServerStore } = await vite.ssrLoadModule('/functions/_lib/serverStore.ts')

const store = restServerStore(PROJECT, '', fetch, { host: 'http://127.0.0.1:8080' })
let n = 0
const deps = {
  store,
  now: () => Date.now(),
  makeId: () => `E2E${Date.now().toString(36)}${(++n).toString(36)}`.toUpperCase(),
  // The Auth emulator's ID tokens are unsigned: read the uid, which is all the emulator
  // can vouch for. Only ever used against the emulator.
  verifyUser: async (h) => {
    const m = h?.match(/^Bearer (.+)$/)
    if (!m) return null
    try {
      const payload = JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString())
      return payload.user_id ?? payload.sub ?? null
    } catch {
      return null
    }
  },
}


createHttp(async (req, res) => {
  if (req.url === '/health') return res.end('ok')
  const name = (req.url ?? '').match(/^\/api\/stock\/([A-Za-z]+)$/)?.[1]
  if (!name || req.method !== 'POST') {
    res.statusCode = 404
    return res.end()
  }
  let raw = ''
  for await (const chunk of req) raw += chunk
  try {
    const r = await runStockCommand(deps, name, req.headers.authorization ?? null, raw ? JSON.parse(raw) : null)
    res.writeHead(r.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(r.body))
  } catch (e) {
    console.error(e)
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'internal' }))
  }
}).listen(PORT, '127.0.0.1')
