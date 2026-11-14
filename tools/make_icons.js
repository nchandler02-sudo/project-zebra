'use strict';
/**
 * Generate the home-screen icons (public/icons/icon-192.png, icon-512.png) with no dependencies.
 *   node tools/make_icons.js
 * Design: dark ground with faint zebra stripes and an amber "Z". Content stays inside the central 70%
 * so the icons also work as maskable icons.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const Z = [
  [[0.25, 0.24], [0.75, 0.24], [0.75, 0.35], [0.25, 0.35]], // top bar
  [[0.25, 0.65], [0.75, 0.65], [0.75, 0.76], [0.25, 0.76]], // bottom bar
  [[0.60, 0.31], [0.75, 0.31], [0.40, 0.69], [0.25, 0.69]], // diagonal
];
const GROUND = [0x15, 0x0f, 0x18];
const STRIPE = [0x2a, 0x1e, 0x2b];
const AMBER = [0xff, 0xb0, 0x20];

function pixel(u, v) {
  if (Z.some((p) => inPoly(u, v, p))) return AMBER;
  // diagonal zebra stripes, wider toward the corners
  const t = ((u + v * 0.55) * 9) % 1;
  return t < 0.38 ? STRIPE : GROUND;
}

function crc32(buf) {
  return zlib.crc32 ? zlib.crc32(buf) : (() => { throw new Error('Node 22+ required'); })();
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const SS = 3; // 3x3 supersampling
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
        r += c[0]; g += c[1]; b += c[2];
      }
      const n = SS * SS;
      raw[o++] = Math.round(r / n); raw[o++] = Math.round(g / n); raw[o++] = Math.round(b / n);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const dir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const s of [180, 192, 512]) {
  fs.writeFileSync(path.join(dir, `icon-${s}.png`), png(s));
  console.log(`wrote public/icons/icon-${s}.png`);
}
