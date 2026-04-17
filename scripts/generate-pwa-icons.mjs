import { writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

const icons = [
  { file: '../assets/icon-192.png', size: 192, maskable: false },
  { file: '../assets/icon-512.png', size: 512, maskable: false },
  { file: '../assets/maskable-icon-512.png', size: 512, maskable: true },
]

const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[i] = c >>> 0
}

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  const crc = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, crc])
}

function createPng(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const sourceOffset = y * width * 4
    const targetOffset = y * (width * 4 + 1)
    raw[targetOffset] = 0
    pixels.copy(raw, targetOffset + 1, sourceOffset, sourceOffset + width * 4)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function hex(value) {
  const normalized = value.replace('#', '')
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
    255,
  ]
}

function roundedRect(x, y, width, height, radius, px, py) {
  const cx = px < x + radius ? x + radius : px > x + width - radius ? x + width - radius : px
  const cy = py < y + radius ? y + radius : py > y + height - radius ? y + height - radius : py
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2
}

function lineDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  const x = x1 + t * dx
  const y = y1 + t * dy
  return Math.hypot(px - x, py - y)
}

function setPixel(pixels, size, x, y, color) {
  const offset = (y * size + x) * 4
  pixels[offset] = color[0]
  pixels[offset + 1] = color[1]
  pixels[offset + 2] = color[2]
  pixels[offset + 3] = color[3]
}

function drawIcon(size, maskable) {
  const pixels = Buffer.alloc(size * size * 4)
  const bg = hex(maskable ? '#0d0d0d' : '#161616')
  const surface = hex('#232323')
  const accent = hex('#4f9eff')
  const highlight = hex('#e2e2e2')
  const transparent = [0, 0, 0, 0]

  const pad = maskable ? 0 : Math.round(size * 0.06)
  const radius = maskable ? Math.round(size * 0.22) : Math.round(size * 0.16)
  const card = { x: pad, y: pad, w: size - pad * 2, h: size - pad * 2, r: radius }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = roundedRect(card.x, card.y, card.w, card.h, card.r, x, y) ? bg : transparent
      setPixel(pixels, size, x, y, color)
    }
  }

  const env = {
    x: Math.round(size * 0.22),
    y: Math.round(size * 0.32),
    w: Math.round(size * 0.56),
    h: Math.round(size * 0.36),
    r: Math.round(size * 0.035),
  }
  const stroke = Math.max(4, Math.round(size * 0.035))

  for (let y = env.y - stroke; y <= env.y + env.h + stroke; y++) {
    for (let x = env.x - stroke; x <= env.x + env.w + stroke; x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue

      const inside = roundedRect(env.x, env.y, env.w, env.h, env.r, x, y)
      const inner = roundedRect(env.x + stroke, env.y + stroke, env.w - stroke * 2, env.h - stroke * 2, env.r, x, y)
      if (inside && !inner) setPixel(pixels, size, x, y, accent)
      else if (inner) setPixel(pixels, size, x, y, surface)

      const topLeft = [env.x + stroke, env.y + stroke]
      const topRight = [env.x + env.w - stroke, env.y + stroke]
      const center = [env.x + env.w / 2, env.y + env.h * 0.58]
      if (
        lineDistance(x, y, topLeft[0], topLeft[1], center[0], center[1]) <= stroke / 2 ||
        lineDistance(x, y, topRight[0], topRight[1], center[0], center[1]) <= stroke / 2
      ) {
        setPixel(pixels, size, x, y, accent)
      }
    }
  }

  const shineRadius = Math.round(size * 0.055)
  const shineX = Math.round(size * 0.68)
  const shineY = Math.round(size * 0.28)
  for (let y = shineY - shineRadius; y <= shineY + shineRadius; y++) {
    for (let x = shineX - shineRadius; x <= shineX + shineRadius; x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue
      if (Math.hypot(x - shineX, y - shineY) <= shineRadius) setPixel(pixels, size, x, y, highlight)
    }
  }

  return createPng(size, size, pixels)
}

for (const icon of icons) {
  await writeFile(new URL(icon.file, import.meta.url), drawIcon(icon.size, icon.maskable))
  console.log(`wrote ${icon.file}`)
}
