/**
 * Minimal GIF89a encoder with no dependencies.
 *
 * Supports animated, looping GIFs with a single global colour table and
 * per-frame transparency (alpha === 0 becomes the transparent index, and
 * frames are drawn with disposal method 2 so they never smear).
 *
 * Usage:
 *   encodeGif({ width, height, frames: [{ width, height, pixels }], delayCs, loop })
 * `pixels` is an RGBA buffer (width * height * 4 bytes).
 */

/** LSB-first bit packer, as required by the GIF LZW stream. */
class BitWriter {
  constructor() {
    this.bytes = [];
    this.acc = 0;
    this.bits = 0;
  }
  write(code, size) {
    this.acc |= code << this.bits;
    this.bits += size;
    while (this.bits >= 8) {
      this.bytes.push(this.acc & 0xff);
      this.acc >>>= 8;
      this.bits -= 8;
    }
  }
  flush() {
    if (this.bits > 0) {
      this.bytes.push(this.acc & 0xff);
      this.acc = 0;
      this.bits = 0;
    }
    return Buffer.from(this.bytes);
  }
}

/**
 * GIF flavour of LZW: variable code width from (minCodeSize + 1) up to 12 bits,
 * a clear code before the first pixel, and an end-of-information code at the end.
 */
function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const out = new BitWriter();

  let dict = new Map();
  let nextCode = endCode + 1;
  let codeSize = minCodeSize + 1;

  const reset = () => {
    dict = new Map();
    nextCode = endCode + 1;
    codeSize = minCodeSize + 1;
  };

  out.write(clearCode, codeSize);
  reset();

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const next = indices[i];
    const key = (prefix << 8) | next;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    out.write(prefix, codeSize);
    // Grow the code width *before* taking the new entry, so the encoder
    // switches exactly one code ahead of the decoder (which only learns about
    // the entry when it reads the following code). Doing this after the insert
    // desynchronises the two and produces a corrupt stream.
    if (nextCode > (1 << codeSize) - 1 && codeSize < 12) {
      codeSize++;
    }
    if (nextCode < 4096) {
      dict.set(key, nextCode);
      nextCode++;
    } else {
      // Dictionary is full: start over so the decoder can follow along.
      out.write(clearCode, codeSize);
      reset();
    }
    prefix = next;
  }
  out.write(prefix, codeSize);
  out.write(endCode, codeSize);
  return out.flush();
}

/** Split LZW output into the data sub-blocks GIF expects. */
function subBlocks(data) {
  const parts = [];
  for (let i = 0; i < data.length; i += 255) {
    const slice = data.subarray(i, i + 255);
    parts.push(Buffer.from([slice.length]), slice);
  }
  parts.push(Buffer.from([0])); // block terminator
  return Buffer.concat(parts);
}

/**
 * @param {object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {Array<{pixels: Buffer}>} options.frames RGBA frames, all the same size
 * @param {number} [options.delayCs] frame delay in centiseconds (1/100 s)
 * @param {number} [options.loop] loop count, 0 = forever
 * @returns {Buffer} the complete .gif file
 */
export function encodeGif({ width, height, frames, delayCs = 10, loop = 0 }) {
  // --- build a global colour table from every frame ------------------
  const colors = new Map(); // packed rgb -> [r, g, b]
  let usesTransparency = false;
  for (const frame of frames) {
    const { pixels } = frame;
    for (let i = 0; i < width * height; i++) {
      const alpha = pixels[i * 4 + 3];
      if (alpha === 0) {
        usesTransparency = true;
        continue;
      }
      const key =
        (pixels[i * 4] << 16) | (pixels[i * 4 + 1] << 8) | pixels[i * 4 + 2];
      if (!colors.has(key)) {
        colors.set(key, [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]]);
      }
    }
  }

  const palette = [];
  let transparentIndex = 0;
  if (usesTransparency) {
    palette.push([0, 0, 0]); // index 0 is reserved for "no pixel"
  }
  for (const key of [...colors.keys()].sort((a, b) => a - b)) {
    palette.push(colors.get(key));
  }
  if (palette.length > 256) {
    throw new Error(`too many colours for a GIF: ${palette.length}`);
  }

  let tableBits = 1;
  while (1 << tableBits < palette.length) {
    tableBits++;
  }
  const tableSize = 1 << tableBits;
  const minCodeSize = Math.max(2, tableBits);

  const colorIndex = new Map();
  palette.forEach(([r, g, b], index) => {
    if (usesTransparency && index === 0) {
      return;
    }
    colorIndex.set((r << 16) | (g << 8) | b, index);
  });

  // --- logical screen descriptor -------------------------------------
  const header = Buffer.alloc(13);
  header.write("GIF89a", 0, "ascii");
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  header[10] = 0xf0 | (tableBits - 1); // global table, 8 bit colour resolution
  header[11] = 0; // background colour index
  header[12] = 0; // pixel aspect ratio

  const globalTable = Buffer.alloc(tableSize * 3);
  palette.forEach(([r, g, b], index) => {
    globalTable[index * 3] = r;
    globalTable[index * 3 + 1] = g;
    globalTable[index * 3 + 2] = b;
  });

  const parts = [header, globalTable];

  // --- netscape looping extension ------------------------------------
  parts.push(
    Buffer.from([
      0x21,
      0xff,
      0x0b,
      ...Buffer.from("NETSCAPE2.0", "ascii"),
      0x03,
      0x01,
      loop & 0xff,
      (loop >> 8) & 0xff,
      0x00
    ])
  );

  // --- frames ---------------------------------------------------------
  for (const frame of frames) {
    const { pixels } = frame;
    const indices = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      if (usesTransparency && pixels[i * 4 + 3] === 0) {
        indices[i] = transparentIndex;
        continue;
      }
      const key =
        (pixels[i * 4] << 16) | (pixels[i * 4 + 1] << 8) | pixels[i * 4 + 2];
      const index = colorIndex.get(key);
      if (index === undefined) {
        throw new Error(`colour not in palette: ${key}`);
      }
      indices[i] = index;
    }

    // graphic control extension: disposal 2 (restore to background)
    parts.push(
      Buffer.from([
        0x21,
        0xf9,
        0x04,
        (2 << 2) | (usesTransparency ? 1 : 0),
        delayCs & 0xff,
        (delayCs >> 8) & 0xff,
        transparentIndex,
        0x00
      ])
    );

    // image descriptor
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c;
    descriptor.writeUInt16LE(0, 1);
    descriptor.writeUInt16LE(0, 3);
    descriptor.writeUInt16LE(width, 5);
    descriptor.writeUInt16LE(height, 7);
    parts.push(descriptor);

    parts.push(
      Buffer.from([minCodeSize]),
      subBlocks(lzwEncode(indices, minCodeSize))
    );
  }

  parts.push(Buffer.from([0x3b])); // trailer
  return Buffer.concat(parts);
}
