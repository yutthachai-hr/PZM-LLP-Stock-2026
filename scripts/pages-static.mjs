// A static server that behaves like Cloudflare Pages where the service worker cares: a request for a `.html` file is
// answered 308 to the same path without the extension (query kept) — Pages does this for `/index.html` — and every
// other unknown path falls back as public/_redirects says. Test-only (e2e/sw-navigation.demo.ts).
// Usage: node scripts/pages-static.mjs <dir> <port>
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const [dir, port] = [path.resolve(process.argv[2]), Number(process.argv[3])]
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
const send = (res, file, status = 200) => {
  res.writeHead(status, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
  fs.createReadStream(file).pipe(res)
}
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const rel = decodeURIComponent(url.pathname)
  if (rel.endsWith('.html')) {
    const pretty = rel === '/index.html' ? '/' : rel.slice(0, -'.html'.length)
    res.writeHead(308, { location: pretty + url.search }); return res.end()
  }
  const file = path.join(dir, rel)
  if (file.startsWith(dir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return send(res, file)
  if (rel === '/supplier' || rel.startsWith('/supplier/po/')) return send(res, path.join(dir, 'supplier.html'))
  return send(res, path.join(dir, 'index.html'))
}).listen(port, '127.0.0.1')
