// Genera build/icon.ico a partir de un PNG (sin dependencias externas).
// Uso: node build/gen-ico.js renderer/logogeo.png build/icon.ico
const fs = require("fs");
const zlib = require("zlib");

const SRC = process.argv[2] || "renderer/logogeo.png";
const OUT = process.argv[3] || "build/icon.ico";
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// ---------- decodificar PNG ----------
const buf = fs.readFileSync(SRC);
if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("No es un PNG válido");

let off = 8, ihdr = null;
const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString("ascii", off + 4, off + 8);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === "IHDR") {
    ihdr = {
      w: data.readUInt32BE(0), h: data.readUInt32BE(4),
      bitDepth: data[8], colorType: data[9], interlace: data[12]
    };
  } else if (type === "IDAT") {
    idat.push(data);
  } else if (type === "IEND") {
    break;
  }
  off += 12 + len;
}
if (!ihdr) throw new Error("Falta IHDR");
if (ihdr.bitDepth !== 8 || ihdr.interlace !== 0) {
  throw new Error("PNG no soportado (bitDepth=" + ihdr.bitDepth + ", interlace=" + ihdr.interlace + ")");
}
const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
if (!bpp) throw new Error("Tipo de color no soportado: " + ihdr.colorType);

const { w, h } = ihdr;
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = w * bpp;
const pix = Buffer.alloc(h * stride);

let pos = 0;
for (let y = 0; y < h; y++) {
  const filter = raw[pos++];
  const line = raw.subarray(pos, pos + stride);
  pos += stride;
  const cur = pix.subarray(y * stride, (y + 1) * stride);
  const prev = y > 0 ? pix.subarray((y - 1) * stride, y * stride) : null;
  for (let x = 0; x < stride; x++) {
    let v = line[x];
    const a = x >= bpp ? cur[x - bpp] : 0;
    const b = prev ? prev[x] : 0;
    const c = prev && x >= bpp ? prev[x - bpp] : 0;
    switch (filter) {
      case 0: break;
      case 1: v = (v + a) & 255; break;
      case 2: v = (v + b) & 255; break;
      case 3: v = (v + ((a + b) >> 1)) & 255; break;
      case 4: {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
        break;
      }
      default: throw new Error("Filtro desconocido: " + filter);
    }
    cur[x] = v;
  }
}

// ---------- a RGBA ----------
const rgba = Buffer.alloc(w * h * 4);
for (let i = 0, j = 0; i < w * h; i++) {
  if (ihdr.colorType === 6) {
    rgba[i * 4] = pix[i * 4]; rgba[i * 4 + 1] = pix[i * 4 + 1];
    rgba[i * 4 + 2] = pix[i * 4 + 2]; rgba[i * 4 + 3] = pix[i * 4 + 3];
  } else if (ihdr.colorType === 2) {
    rgba[i * 4] = pix[i * 3]; rgba[i * 4 + 1] = pix[i * 3 + 1];
    rgba[i * 4 + 2] = pix[i * 3 + 2]; rgba[i * 4 + 3] = 255;
  } else if (ihdr.colorType === 0) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = pix[i]; rgba[i * 4 + 3] = 255;
  } else { // gray+alpha
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = pix[i * 2];
    rgba[i * 4 + 3] = pix[i * 2 + 1];
  }
}
console.log("PNG decodificado: " + w + "x" + h + " colorType=" + ihdr.colorType);

// ---------- redimensionar (box average) ----------
function resize(size) {
  const dst = Buffer.alloc(size * size * 4);
  const xr = w / size, yr = h / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * yr), y1 = Math.max(y0 + 1, Math.floor((y + 1) * yr));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * xr), x1 = Math.max(x0 + 1, Math.floor((x + 1) * xr));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; a += rgba[i + 3]; n++;
        }
      }
      const j = (y * size + x) * 4;
      dst[j] = (r / n) | 0; dst[j + 1] = (g / n) | 0;
      dst[j + 2] = (b / n) | 0; dst[j + 3] = (a / n) | 0;
    }
  }
  return dst;
}

// ---------- entrada BMP del ICO ----------
function bmpEntry(size, data) {
  const maskRow = ((size + 31) >> 5) << 2;      // filas de la máscara AND alineadas a 4 bytes
  const maskSize = maskRow * size;
  const header = Buffer.alloc(40);              // BITMAPINFOHEADER (little-endian)
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);             // altura doble (xor + and)
  header.writeUInt16LE(1, 12);                  // planes
  header.writeUInt16LE(32, 14);                 // bits por píxel
  header.writeUInt32LE(0, 16);                  // compresión = BI_RGB
  header.writeUInt32LE(data.length + maskSize, 20);
  const pixels = Buffer.alloc(size * size * 4); // filas de abajo hacia arriba, BGRA
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4;
    data.copy(pixels, y * size * 4, src, src + size * 4);
  }
  for (let i = 0; i < pixels.length; i += 4) {  // RGBA -> BGRA
    const t = pixels[i]; pixels[i] = pixels[i + 2]; pixels[i + 2] = t;
  }
  return Buffer.concat([header, pixels, Buffer.alloc(maskSize)]); // máscara AND en ceros (usa alfa)
}

// ---------- ensamblar ICO ----------
const entries = SIZES.map((s) => ({ size: s, data: bmpEntry(s, resize(s)) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);                      // reservado
header.writeUInt16LE(1, 2);                      // tipo = icono
header.writeUInt16LE(entries.length, 4);         // número de imágenes

let offset = 6 + entries.length * 16;
const dirEntries = [];
for (const e of entries) {
  const d = Buffer.alloc(16);
  d.writeUInt8(e.size >= 256 ? 0 : e.size, 0);   // ancho (0 = 256)
  d.writeUInt8(e.size >= 256 ? 0 : e.size, 1);   // alto
  d.writeUInt8(0, 2);                            // colores
  d.writeUInt8(0, 3);                            // reservado
  d.writeUInt16LE(1, 4);                         // planos
  d.writeUInt16LE(32, 6);                        // bpp
  d.writeUInt32LE(e.data.length, 8);             // tamaño
  d.writeUInt32LE(offset, 12);                   // desplazamiento
  dirEntries.push(d);
  offset += e.data.length;
}

fs.mkdirSync(require("path").dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, ...dirEntries, ...entries.map((e) => e.data)]));
console.log("ICO generado: " + OUT + " (" + SIZES.join(", ") + " px, " + fs.statSync(OUT).size + " bytes)");
