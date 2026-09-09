// Generates the PWA icons the web manifest declares, from the owner's artwork.
//
//   npm run icons
//
// The source of truth is assets/app-icon.png — the running rabbit chef. It is committed so
// the icons can be regenerated rather than being three binaries nobody can reproduce.
//
// Written with only node:zlib so there is no image dependency to keep up to date. That
// means decoding the source PNG here as well as writing one: a PNG is a header, one
// deflate stream of filtered scanlines, and an end marker.
//
// Three icons come out, because they are not the same picture:
//
//   pwa-192 / pwa-512   `purpose: any`. The artwork keeps its own rounded tile and the
//                       corners are transparent, so it sits on a launcher background as
//                       drawn.
//   pwa-maskable-512    `purpose: maskable`. Android crops this to whatever shape the
//                       launcher uses — a circle on Pixel, a squircle on Samsung. The
//                       green runs to all four edges and the rabbit is scaled into the
//                       inner 80%, which is the only part guaranteed to survive the crop.
//                       Declaring the `any` file as maskable, which the manifest used to
//                       do, gets the rounded corners and part of the pizza sliced off.
//   apple-touch-icon    iOS ignores the manifest, rounds the corners itself, and paints
//                       transparency black. So: square, full bleed, no alpha.
//   favicon-32          The browser tab. This replaced public/favicon.svg, which was still
//                       the purple Vite starter logo — the tab has been showing another
//                       project's mark since the day this repo was created.

import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'assets', 'app-icon.png')
const OUT_DIR = join(ROOT, 'public')

// ---------------------------------------------------------------- PNG plumbing

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

/** An image as flat RGBA bytes. */
function image(width, height, data = Buffer.alloc(width * height * 4)) {
  return { width, height, data }
}

/** Read a non-interlaced 8-bit RGB or RGBA PNG into RGBA bytes. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${SRC}: not a PNG`)
  let pos = 8
  let head = null
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      head = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        color: data[9],
        interlace: data[12],
      }
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (!head) throw new Error(`${SRC}: no IHDR`)
  if (head.depth !== 8 || head.interlace !== 0 || (head.color !== 2 && head.color !== 6)) {
    throw new Error(
      `${SRC}: need an 8-bit non-interlaced RGB or RGBA PNG, got depth ${head.depth} colour type ${head.color} interlace ${head.interlace}`,
    )
  }

  const channels = head.color === 6 ? 4 : 3
  const stride = head.width * channels
  const raw = inflateSync(Buffer.concat(idat))
  const out = image(head.width, head.height)
  const line = Buffer.alloc(stride)
  const prev = Buffer.alloc(stride)

  for (let y = 0; y < head.height; y++) {
    const filter = raw[y * (stride + 1)]
    raw.copy(line, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let add = 0
      if (filter === 1) add = a
      else if (filter === 2) add = b
      else if (filter === 3) add = (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) throw new Error(`${SRC}: unknown row filter ${filter}`)
      line[i] = (line[i] + add) & 0xff
    }
    for (let x = 0; x < head.width; x++) {
      const s = x * channels
      const d = (y * head.width + x) * 4
      out.data[d] = line[s]
      out.data[d + 1] = line[s + 1]
      out.data[d + 2] = line[s + 2]
      out.data[d + 3] = channels === 4 ? line[s + 3] : 255
    }
    line.copy(prev)
  }
  return out
}

/**
 * Encode RGBA bytes as a PNG, picking a row filter per row.
 *
 * Filtering each row against its neighbours turns runs of similar pixels into small
 * deltas that deflate can pack. The heuristic — lowest sum of absolute byte values read
 * as signed — is the one libpng uses, and on this artwork it lands within 1.5% of
 * Pillow's optimised encoder (294KB against 290KB for the 512), so there is nothing left
 * to win here. The size actually comes out of `denoise` below.
 */
function encodePng({ width, height, data }) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)]
  const bpp = 4
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride)
    const up = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0
      const b = up ? up[i] : 0
      const c = up && i >= bpp ? up[i - bpp] : 0
      const pp = a + b - c
      const pa = Math.abs(pp - a)
      const pb = Math.abs(pp - b)
      const pc = Math.abs(pp - c)
      cand[0][i] = row[i]
      cand[1][i] = (row[i] - a) & 0xff
      cand[2][i] = (row[i] - b) & 0xff
      cand[3][i] = (row[i] - ((a + b) >> 1)) & 0xff
      cand[4][i] = (row[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
    }
    let best = 0
    let bestScore = Infinity
    for (let f = 0; f < 5; f++) {
      let score = 0
      for (let i = 0; i < stride; i++) {
        const v = cand[f][i]
        score += v < 128 ? v : 256 - v
      }
      if (score < bestScore) {
        bestScore = score
        best = f
      }
    }
    raw[y * (stride + 1)] = best
    cand[best].copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------- shaping

/**
 * Cut the artwork out of the white page it was drawn on.
 *
 * A threshold alone would punch holes in the chef's hat, which is white too. Flooding in
 * from the corners only reaches the white that is connected to the outside, so the hat —
 * fenced in by green — stays. That connectivity is also why the threshold can be as low as
 * 205: it only ever eats the pale ring where the tile edge was anti-aliased against the
 * page, which otherwise survives as a light outline once the icon is laid on green.
 */
function cutout(src, white = 205) {
  const { width, height, data } = src
  const outside = new Uint8Array(width * height)
  const isWhite = (i) => data[i * 4] >= white && data[i * 4 + 1] >= white && data[i * 4 + 2] >= white
  const stack = []
  for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x)
  for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1)
  while (stack.length) {
    const i = stack.pop()
    if (outside[i] || !isWhite(i)) continue
    outside[i] = 1
    const x = i % width
    const y = (i - x) / width
    if (x > 0) stack.push(i - 1)
    if (x < width - 1) stack.push(i + 1)
    if (y > 0) stack.push(i - width)
    if (y < height - 1) stack.push(i + width)
  }

  // The tile was drawn anti-aliased against the page, which leaves one pixel of half-white
  // half-green along every edge — (153, 228, 175) where the tile is (2, 183, 68). The
  // flood cannot take it (its red channel is nowhere near white) and the downsample smears
  // it across the boundary, so the maskable icon came out with a pale rounded line tracing
  // the old tile through its own background. Two pixels of erosion drops the blend band.
  for (let pass = 0; pass < 2; pass++) {
    const edge = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (outside[i]) continue
        if (
          (x > 0 && outside[i - 1]) ||
          (x < width - 1 && outside[i + 1]) ||
          (y > 0 && outside[i - width]) ||
          (y < height - 1 && outside[i + width])
        ) {
          edge.push(i)
        }
      }
    }
    for (const i of edge) outside[i] = 1
  }

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (outside[y * width + x]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) throw new Error(`${SRC}: the whole image reads as background`)

  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const out = image(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y + minY) * width + (x + minX)) * 4
      const d = (y * w + x) * 4
      out.data[d] = data[s]
      out.data[d + 1] = data[s + 1]
      out.data[d + 2] = data[s + 2]
      out.data[d + 3] = outside[(y + minY) * width + (x + minX)] ? 0 : 255
    }
  }
  return out
}

/** Box-filter downsample. Alpha is premultiplied first so the cut edge does not grey out. */
function resize(src, size) {
  const out = image(size, size)
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor((y * src.height) / size)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * src.height) / size))
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor((x * src.width) / size)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * src.width) / size))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * src.width + sx) * 4
          const al = src.data[i + 3] / 255
          r += src.data[i] * al
          g += src.data[i + 1] * al
          b += src.data[i + 2] * al
          a += al
          n++
        }
      }
      const d = (y * size + x) * 4
      if (a > 0) {
        out.data[d] = Math.round(r / a)
        out.data[d + 1] = Math.round(g / a)
        out.data[d + 2] = Math.round(b / a)
      }
      out.data[d + 3] = Math.round((a / n) * 255)
    }
  }
  return out
}

/** Centre square crop, keeping `frac` of the shorter side. */
function crop(src, frac) {
  const side = Math.round(Math.min(src.width, src.height) * frac)
  const x0 = Math.round((src.width - side) / 2)
  const y0 = Math.round((src.height - side) / 2)
  const out = image(side, side)
  for (let y = 0; y < side; y++) {
    src.data.copy(
      out.data,
      y * side * 4,
      ((y + y0) * src.width + x0) * 4,
      ((y + y0) * src.width + x0 + side) * 4,
    )
  }
  return out
}

/** Paint `src` centred on an opaque `bg` square of `size`, scaled to `scale` of it. */
function onSolid(src, size, bg, scale) {
  const inner = Math.round(size * scale)
  const art = resize(src, inner)
  const off = Math.round((size - inner) / 2)
  const out = image(size, size)
  for (let i = 0; i < size * size; i++) {
    out.data[i * 4] = bg[0]
    out.data[i * 4 + 1] = bg[1]
    out.data[i * 4 + 2] = bg[2]
    out.data[i * 4 + 3] = 255
  }
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const s = (y * inner + x) * 4
      const al = art.data[s + 3] / 255
      if (al === 0) continue
      const d = ((y + off) * size + (x + off)) * 4
      for (let c = 0; c < 3; c++) {
        out.data[d + c] = Math.round(out.data[d + c] * (1 - al) + art.data[s + c] * al)
      }
    }
  }
  return out
}

/**
 * Round each colour channel to 64 levels.
 *
 * The artwork went through a lossy round trip before it reached here: a drawing of maybe
 * fifty flat colours arrives carrying 23,521 of them, and the rest is dither noise no
 * launcher icon will ever show. Deflate cannot compress noise, so it was two thirds of
 * the file. Snapping to multiples of four collapses it to 6,159 colours — measured on the
 * 512, 294KB before and 131KB after, with nothing visible to lose at that size.
 *
 * Alpha is left alone: it is a hard cut around the tile and has to stay one.
 */
function denoise(img, step = 4) {
  const half = step >> 1
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      img.data[i + c] = Math.min(255, Math.floor(img.data[i + c] / step) * step + half)
    }
  }
  return img
}

/**
 * The tile's own background colour, as the commonest opaque colour in a band just inside
 * the edge.
 *
 * Both halves of that matter. The whole image is no good — the rabbit is white, and white
 * wins the count. A one-pixel ring is no good either: the flat green is not actually flat,
 * it carries the same dither as everything else, and a thin sample landed on 184 where the
 * field mostly sits at 182. Those are two sides of a `denoise` bucket, and a four-level
 * step across a flat area reads as a line — the old tile's outline, ghosting through the
 * maskable icon's background. A band a few percent deep is background everywhere and large
 * enough for the real mode to win.
 */
function tileColour(src) {
  const counts = new Map()
  const depth = Math.max(4, Math.round(Math.min(src.width, src.height) * 0.05))
  const inBand = (x, y) =>
    x < depth || y < depth || x >= src.width - depth || y >= src.height - depth
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (!inBand(x, y)) continue
      const i = (y * src.width + x) * 4
      if (src.data[i + 3] < 250) continue
      const key = (src.data[i] << 16) | (src.data[i + 1] << 8) | src.data[i + 2]
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  let best = -1
  let bestN = 0
  for (const [key, n] of counts) {
    if (n > bestN) {
      bestN = n
      best = key
    }
  }
  if (best < 0) throw new Error(`${SRC}: no opaque pixel around the edge`)
  return [(best >> 16) & 0xff, (best >> 8) & 0xff, best & 0xff]
}

// ---------------------------------------------------------------- run

const art = cutout(decodePng(readFileSync(SRC)))
const bg = tileColour(art)
console.log(`source ${art.width}x${art.height}, tile rgb(${bg.join(', ')})`)

mkdirSync(OUT_DIR, { recursive: true })

const wrote = (name, img) => {
  const file = join(OUT_DIR, name)
  const bytes = encodePng(denoise(img))
  writeFileSync(file, bytes)
  console.log(`wrote ${file} (${Math.round(bytes.length / 1024)}KB)`)
}

for (const size of [192, 512]) wrote(`pwa-${size}.png`, resize(art, size))
// A tab favicon is 16 CSS pixels wide in practice. Full bleed, because transparent
// corners just make it look chipped at that size — and cropped in to 78%, because the
// whole drawing at 32px is a green square with a smudge in it, while dropping the empty
// green margin makes the chef's hat and the pizza large enough to tell apart.
wrote('favicon-32.png', onSolid(crop(art, 0.78), 32, bg, 1))
// 80% is the maskable safe zone: everything outside it is the launcher's to crop.
wrote('pwa-maskable-512.png', onSolid(art, 512, bg, 0.8))
// iOS rounds the corners itself, so the artwork can run almost to the edge.
wrote('apple-touch-icon.png', onSolid(art, 180, bg, 1))
