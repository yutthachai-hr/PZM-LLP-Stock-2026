// Generates the PWA icons the web manifest declares.
//
//   npm run icons
//
// The manifest named pwa-192.png and pwa-512.png and neither file existed, so installing
// the app got whatever the browser fell back to. They are drawn here rather than checked in
// as binaries nobody can edit: the shapes are a few circles, and regenerating after a colour
// change is one command.
//
// Written with only node:zlib so there is no image dependency to keep up to date. PNG is
// simple enough for this: a header, one deflate stream of filtered scanlines, and an end
// marker.

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** @param {(x: number, y: number) => [number, number, number, number]} shade */
function png(size, shade) {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = shade(x, y)
      const i = rowStart + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Pizza Mania red, matching theme_color in the manifest.
const BG = [185, 28, 28]
const CRUST = [251, 191, 36]
const CHEESE = [254, 243, 199]
const TOPPING = [153, 27, 27]

/** Anti-aliased coverage of a disc at (cx, cy) with radius r, sampled at pixel centres. */
function disc(x, y, cx, cy, r) {
  const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
  return Math.max(0, Math.min(1, r - d + 0.5))
}

function mix(base, over, amount) {
  if (amount <= 0) return base
  return [
    Math.round(base[0] + (over[0] - base[0]) * amount),
    Math.round(base[1] + (over[1] - base[1]) * amount),
    Math.round(base[2] + (over[2] - base[2]) * amount),
  ]
}

function draw(size) {
  const c = size / 2
  // Keep the artwork inside the safe area so a maskable crop does not cut it.
  const crustR = size * 0.34
  const cheeseR = size * 0.27
  const toppings = [
    [0.5, 0.38, 0.05],
    [0.62, 0.55, 0.045],
    [0.4, 0.58, 0.045],
    [0.55, 0.68, 0.038],
    [0.38, 0.44, 0.038],
  ]

  return (x, y) => {
    let rgb = BG
    rgb = mix(rgb, CRUST, disc(x, y, c, c, crustR))
    rgb = mix(rgb, CHEESE, disc(x, y, c, c, cheeseR))
    for (const [fx, fy, fr] of toppings) {
      rgb = mix(rgb, TOPPING, disc(x, y, size * fx, size * fy, size * fr))
    }
    return [rgb[0], rgb[1], rgb[2], 255]
  }
}

mkdirSync(OUT_DIR, { recursive: true })
for (const size of [192, 512]) {
  const file = join(OUT_DIR, `pwa-${size}.png`)
  writeFileSync(file, png(size, draw(size)))
  console.log(`wrote ${file}`)
}
