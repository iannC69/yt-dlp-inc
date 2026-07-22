/**
 * Generates installer-assets/installer-sidebar.bmp  (164×314)
 *                  installer-assets/installer-header.bmp  (150×57)
 *                  installer-assets/app-icon.ico          (multi-res)
 * Pure-JS, zero external deps.
 */
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT      = path.resolve(__dirname, '..')
const DEST      = path.join(ROOT, 'installer-assets')
fs.mkdirSync(DEST, { recursive: true })

// ─── helpers ────────────────────────────────────────────────────────────────
const clamp = (v, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, v))
const lerp  = (a, b, t) => a + (b - a) * clamp(t, 0, 1)
const mix   = (c1, c2, t) => ({
  r: lerp(c1.r, c2.r, t),
  g: lerp(c1.g, c2.g, t),
  b: lerp(c1.b, c2.b, t),
})
const rgb = (r, g, b) => ({ r, g, b })

// App colour palette
const BG      = rgb(8,   10,  15)   // #080a0f
const SURF    = rgb(24,  24,  27)   // #18181b
const RED     = rgb(239, 68,  68)   // #ef4444
const PURPLE  = rgb(168, 85,  247)  // #a855f7
const INDIGO  = rgb(99,  102, 241)  // #6366f1
const WHITE   = rgb(255, 255, 255)

/** Gradient red→indigo→purple along t=0..1 */
function brandGrad(t) {
  if (t < 0.5) return mix(RED, INDIGO, t * 2)
  return mix(INDIGO, PURPLE, (t - 0.5) * 2)
}

// ─── BMP writer ─────────────────────────────────────────────────────────────
function writeBMP(W, H, fn) {
  const stride = Math.ceil(W * 3 / 4) * 4
  const pixSz  = stride * H
  const buf    = Buffer.alloc(54 + pixSz, 0)

  buf.write('BM', 0, 'ascii')
  buf.writeUInt32LE(54 + pixSz, 2)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(W, 18)
  buf.writeInt32LE(H, 22)        // positive = bottom-up
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(pixSz, 34)
  buf.writeInt32LE(2835, 38)
  buf.writeInt32LE(2835, 42)

  for (let y = 0; y < H; y++) {
    const imgY = H - 1 - y     // flip: BMP is bottom-up
    for (let x = 0; x < W; x++) {
      const p   = fn(x, imgY)
      const off = 54 + y * stride + x * 3
      buf[off]     = clamp(Math.round(p.b))
      buf[off + 1] = clamp(Math.round(p.g))
      buf[off + 2] = clamp(Math.round(p.r))
    }
  }
  return buf
}

// ─── SIDEBAR 164×314 ────────────────────────────────────────────────────────
function sidebar() {
  const W = 164, H = 314

  // Pre-compute noise-like small variation per pixel
  function noise(x, y) {
    return (Math.sin(x * 0.31 + y * 0.17) * 0.5 + 0.5) * 4
  }

  return writeBMP(W, H, (x, y) => {
    const yn = y / H
    const xn = x / W

    /* 1 — dark base gradient, slightly lighter toward centre-top */
    const bgBrightness = 0.12 + Math.pow(1 - Math.abs(yn - 0.35) * 1.5, 2) * 0.08
    let c = rgb(
      BG.r + bgBrightness * 30 + noise(x, y),
      BG.g + bgBrightness * 25 + noise(x + 7, y),
      BG.b + bgBrightness * 60 + noise(x, y + 5)
    )

    /* 2 — fine diagonal scanlines */
    if ((x + y) % 28 < 1.5) {
      c.r += 5; c.g += 3; c.b += 12
    }

    /* 3 — subtle grid */
    if (x % 20 === 0 || y % 20 === 0) {
      c.r += 3; c.g += 2; c.b += 7
    }

    /* 4 — brand gradient glow orb (main focal point) */
    const orbX = W * 0.5, orbY = H * 0.40
    const dist  = Math.sqrt((x - orbX) ** 2 + (y - orbY) ** 2)
    const orbOuter = 70, orbMid = 44, orbInner = 20

    if (dist < orbOuter) {
      const t     = 1 - dist / orbOuter
      const gradT = yn * 0.6               // red at top-left, purple lower
      const glowC = brandGrad(gradT)
      c = mix(c, glowC, Math.pow(t, 1.6) * 0.9)

      if (dist < orbMid) {
        const t2  = 1 - dist / orbMid
        const mid = mix(glowC, rgb(220, 180, 255), 0.4)
        c = mix(c, mid, Math.pow(t2, 1.3) * 0.85)
      }
      if (dist < orbInner) {
        const t3 = 1 - dist / orbInner
        c = mix(c, rgb(255, 240, 255), Math.pow(t3, 1.5) * 0.9)
      }
      /* ring rim */
      if (dist > orbOuter - 2.5 && dist < orbOuter) {
        c = mix(c, brandGrad(0.7), 0.6)
      }
    }

    /* 5 — small satellite orb (bottom-right, pink-purple accent) */
    const s2x = W * 0.82, s2y = H * 0.72
    const d2  = Math.sqrt((x - s2x) ** 2 + (y - s2y) ** 2)
    if (d2 < 22) {
      c = mix(c, rgb(236, 72, 153), Math.pow(1 - d2 / 22, 2) * 0.45)
    }

    /* 6 — third micro orb (top-right) */
    const s3x = W * 0.80, s3y = H * 0.12
    const d3  = Math.sqrt((x - s3x) ** 2 + (y - s3y) ** 2)
    if (d3 < 14) {
      c = mix(c, RED, Math.pow(1 - d3 / 14, 2) * 0.4)
    }

    /* 7 — left accent bar (4 px gradient strip) */
    if (x < 4) {
      c = mix(brandGrad(1 - yn), rgb(50, 20, 90), Math.abs(yn - 0.4))
    }

    /* 8 — horizontal separator line */
    if (y >= Math.round(H * 0.695) && y <= Math.round(H * 0.695) + 1) {
      c = mix(c, brandGrad(0.6), 0.55)
    }

    /* 9 — dot grid below separator */
    if (y > H * 0.72 && y < H * 0.965) {
      const dx = (x + 5) % 13, dy = (y + 5) % 13
      if (dx < 2 && dy < 2) {
        const fade = (y - H * 0.72) / (H * 0.245)
        c = mix(c, brandGrad(0.8), 0.45 * (1 - fade * fade))
      }
    }

    /* 10 — top + bottom edge vignette */
    if (y < 22) {
      c = mix(rgb(0, 0, 5), c, Math.pow(y / 22, 0.7))
    }
    if (y > H - 16) {
      c = mix(rgb(0, 0, 0), c, Math.pow((H - y) / 16, 0.7))
    }

    return c
  })
}

// ─── HEADER 150×57 ──────────────────────────────────────────────────────────
function header() {
  const W = 150, H = 57

  return writeBMP(W, H, (x, y) => {
    const xn = x / W, yn = y / H

    /* base dark surface */
    let c = rgb(
      SURF.r - 4 + xn * 6,
      SURF.g - 2 + xn * 3,
      SURF.b + 6  + xn * 12
    )

    /* right-area diagonal accent lines */
    if (x > W - 50) {
      const d = ((x * 1.2 + y * 0.6) % 24) / 24
      if (d < 0.08) {
        c.r += 20; c.g += 5; c.b += 50
      }
    }

    /* subtle horizontal gradient overlay */
    c = mix(c, rgb(BG.r, BG.g, BG.b + 10), 1 - xn * 0.3)

    /* top-right mini glow */
    const gr = Math.sqrt((x - (W - 12)) ** 2 + (y - 12) ** 2)
    if (gr < 22) {
      c = mix(c, brandGrad(0.5 + yn * 0.5), Math.pow(1 - gr / 22, 2.5) * 0.55)
    }

    /* left gradient accent strip (5px) */
    if (x < 5) {
      c = brandGrad(yn * 0.6)
      if (x >= 4) c = mix(c, rgb(SURF.r, SURF.g, SURF.b + 15), 0.5)
    }

    /* bottom border */
    if (y >= H - 2) c = mix(c, brandGrad(0.65), 0.8)

    /* top hairline highlight */
    if (y === 0) c = mix(c, rgb(80, 50, 110), 0.5)

    return c
  })
}

// ─── ICO (multi-resolution embedded BMPs) ───────────────────────────────────
function makeBMPForICO(SIZE) {
  const orbR = SIZE * 0.42

  // Pixel font "M" (5 cols × 7 rows)
  const M_BITS = [
    [1,0,0,0,1],
    [1,1,0,1,1],
    [1,0,1,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
  ]
  const SCALE  = Math.max(1, Math.round(SIZE / 8))
  const LW     = 5 * SCALE, LH = 7 * SCALE
  const OX     = Math.round((SIZE - LW) / 2)
  const OY     = Math.round((SIZE - LH) / 2) - Math.round(SIZE * 0.03)

  function px(x, y) {
    const cx = SIZE / 2, cy = SIZE / 2
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    const tn   = dist / (SIZE * 0.5)

    /* circular background: gradient from red (left) to purple (right) */
    const gradT = (x / SIZE) * 0.85 + 0.1
    let c = dist < orbR
      ? mix(brandGrad(gradT), BG, clamp(tn * 1.4 - 0.6, 0, 1))
      : BG

    /* rim glow */
    if (dist > orbR - SIZE * 0.035 && dist < orbR + SIZE * 0.01) {
      c = mix(c, brandGrad(gradT), 0.75)
    }

    /* "M" letter */
    const lx = Math.floor((x - OX) / SCALE)
    const ly = Math.floor((y - OY) / SCALE)
    if (lx >= 0 && lx < 5 && ly >= 0 && ly < 7 && M_BITS[ly]?.[lx]) {
      const innerT = 1 - clamp(dist / orbR, 0, 1)
      /* letter glow: white-ish core, slight purple tint edges */
      c = mix(rgb(240, 225, 255), rgb(200, 160, 255), 1 - innerT)
    }

    return c
  }

  const stride    = Math.ceil(SIZE * 3 / 4) * 4
  const andStride = Math.ceil(SIZE / 8 / 4) * 4
  const totalSz   = 40 + stride * SIZE + andStride * SIZE
  const buf       = Buffer.alloc(totalSz, 0)

  buf.writeUInt32LE(40, 0)
  buf.writeInt32LE(SIZE, 4)
  buf.writeInt32LE(SIZE * 2, 8)   // height × 2 for ICO (XOR + AND masks)
  buf.writeUInt16LE(1, 12)
  buf.writeUInt16LE(24, 14)
  buf.writeUInt32LE(stride * SIZE, 20)

  for (let y = 0; y < SIZE; y++) {
    const imgY = SIZE - 1 - y
    for (let x = 0; x < SIZE; x++) {
      const p   = px(x, imgY)
      const off = 40 + y * stride + x * 3
      buf[off]     = clamp(Math.round(p.b))
      buf[off + 1] = clamp(Math.round(p.g))
      buf[off + 2] = clamp(Math.round(p.r))
    }
  }
  // AND mask: all 0 (fully opaque)
  return buf
}

function generateICO() {
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const bmps  = sizes.map(s => makeBMPForICO(s))

  const ICONDIR_SZ   = 6
  const ENTRY_SZ     = 16
  const headerSz     = ICONDIR_SZ + sizes.length * ENTRY_SZ

  const header = Buffer.alloc(headerSz, 0)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)

  let offset = headerSz
  for (let i = 0; i < sizes.length; i++) {
    const s   = sizes[i]
    const base = ICONDIR_SZ + i * ENTRY_SZ
    header[base]     = s === 256 ? 0 : s
    header[base + 1] = s === 256 ? 0 : s
    header[base + 2] = 0
    header[base + 3] = 0
    header.writeUInt16LE(1, base + 4)
    header.writeUInt16LE(24, base + 6)
    header.writeUInt32LE(bmps[i].length, base + 8)
    header.writeUInt32LE(offset, base + 12)
    offset += bmps[i].length
  }

  return Buffer.concat([header, ...bmps])
}

// ─── Write files ─────────────────────────────────────────────────────────────
fs.writeFileSync(path.join(DEST, 'installer-sidebar.bmp'), sidebar())
console.log('✓ installer-sidebar.bmp (164×314)')

fs.writeFileSync(path.join(DEST, 'installer-header.bmp'), header())
console.log('✓ installer-header.bmp (150×57)')

fs.writeFileSync(path.join(DEST, 'app-icon.ico'), generateICO())
console.log('✓ app-icon.ico (16/24/32/48/64/128/256 px)')

console.log('\nAssets written to installer-assets/')
