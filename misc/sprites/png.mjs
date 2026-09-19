/**
 * Minimal PNG support (8 bit RGBA, no interlacing) with no dependencies.
 *
 * Only what the sprite tools need: encoding true-colour frames and decoding
 * back the PNGs that end up inside a .piskel file.
 */
import zlib from "node:zlib";

export function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGBA buffer (width * height * 4 bytes) as a PNG. */
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

/** Decode a PNG produced by encodePng (8 bit RGBA, filter type 0). */
export function decodePng(buffer) {
  if (buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    throw new Error("not a PNG");
  }
  let off = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (off < buffer.length) {
    const len = buffer.readUInt32BE(off);
    const type = buffer.toString("ascii", off + 4, off + 8);
    if (type === "IHDR") {
      width = buffer.readUInt32BE(off + 8);
      height = buffer.readUInt32BE(off + 12);
      if (buffer[off + 16] !== 8 || buffer[off + 17] !== 6) {
        throw new Error("only 8 bit RGBA PNGs are supported");
      }
    } else if (type === "IDAT") {
      idat.push(buffer.subarray(off + 8, off + 8 + len));
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter !== 0) {
      throw new Error(`unsupported PNG filter ${filter}`);
    }
    raw.copy(
      pixels,
      y * stride,
      y * (stride + 1) + 1,
      y * (stride + 1) + 1 + stride
    );
  }
  return { width, height, pixels };
}

/** Nearest-neighbour upscale of an RGBA buffer. */
export function scaleRgba(image, factor) {
  const { width, height, pixels } = image;
  const out = Buffer.alloc(width * factor * height * factor * 4);
  for (let y = 0; y < height * factor; y++) {
    for (let x = 0; x < width * factor; x++) {
      const src = (Math.floor(y / factor) * width + Math.floor(x / factor)) * 4;
      const dst = (y * width * factor + x) * 4;
      pixels.copy(out, dst, src, src + 4);
    }
  }
  return { width: width * factor, height: height * factor, pixels: out };
}

/** Composite RGBA onto an opaque background colour. */
export function flattenRgba(image, hex) {
  const { width, height, pixels } = image;
  const [br, bg, bb] = hexToRgb(hex);
  const out = Buffer.from(pixels);
  for (let i = 0; i < width * height; i++) {
    const alpha = out[i * 4 + 3];
    if (alpha === 255) {
      continue;
    }
    const a = alpha / 255;
    out[i * 4] = Math.round(out[i * 4] * a + br * (1 - a));
    out[i * 4 + 1] = Math.round(out[i * 4 + 1] * a + bg * (1 - a));
    out[i * 4 + 2] = Math.round(out[i * 4 + 2] * a + bb * (1 - a));
    out[i * 4 + 3] = 255;
  }
  return { width, height, pixels: out };
}
