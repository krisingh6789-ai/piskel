/**
 * Verifies the generated "Transformer Red" .piskel file the same way the
 * Piskel editor loads it, without a browser:
 *
 *   1. read the file like FileReader + Base64.toText does
 *   2. JSON.parse it, check modelVersion against src/js/Constants.js
 *   3. run the same steps as pskl.utils.serialization.Deserializer:
 *      parse each layer, walk its chunks, slice frames using the chunk
 *      layout (see pskl.utils.FrameUtils.createFramesFromChunk)
 *   4. compare the decoded frames with the standalone sprite sheet
 *
 * Usage: node misc/sprites/verify-transformer-red.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NAME = "transformer-red";

const constantsSrc = fs.readFileSync(
  path.join(__dirname, "../../src/js/Constants.js"),
  "utf8"
);
const modelVersion = Number(
  constantsSrc.match(/MODEL_VERSION\s*[:=]\s*(\d+)/)[1]
);

/** Minimal PNG decoder for the files this script writes (8 bit RGBA, filter 0). */
function decodePng(buffer) {
  assert.equal(buffer.toString("hex", 0, 8), "89504e470d0a1a0a", "not a PNG");
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
      assert.equal(buffer[off + 16], 8, "expected 8 bit depth");
      assert.equal(buffer[off + 17], 6, "expected RGBA colour type");
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
    assert.equal(filter, 0, `unsupported PNG filter ${filter}`);
    raw.copy(
      pixels,
      y * stride,
      y * (stride + 1) + 1,
      y * (stride + 1) + 1 + stride
    );
  }
  return { width, height, pixels };
}

/** Slice a horizontal spritesheet into frames, following the chunk layout. */
function sliceLayout(image, layout) {
  const frameWidth = image.width / layout.length;
  const frameHeight = image.height / layout[0].length;
  assert.ok(
    Number.isInteger(frameWidth),
    `non-integer frame width ${frameWidth}`
  );
  assert.ok(
    Number.isInteger(frameHeight),
    `non-integer frame height ${frameHeight}`
  );

  const frames = [];
  for (let i = 0; i < layout.length; i++) {
    for (let j = 0; j < layout[i].length; j++) {
      const frame = Buffer.alloc(frameWidth * frameHeight * 4);
      for (let y = 0; y < frameHeight; y++) {
        const src = ((j * frameHeight + y) * image.width + i * frameWidth) * 4;
        image.pixels.copy(frame, y * frameWidth * 4, src, src + frameWidth * 4);
      }
      frames[layout[i][j]] = {
        index: layout[i][j],
        width: frameWidth,
        height: frameHeight,
        pixels: frame
      };
    }
  }
  return frames;
}

/* ------------------------------------------------------------------ */
const file = path.join(__dirname, `${NAME}.piskel`);
const rawPiskel = fs.readFileSync(file, "utf8");

const parsed = JSON.parse(rawPiskel); // what decodePiskelFile does
console.log(
  `modelVersion in file: ${parsed.modelVersion} (editor expects ${modelVersion})`
);
assert.equal(parsed.modelVersion, modelVersion, "modelVersion mismatch");

const descriptor = parsed.piskel;
const layerData = JSON.parse(descriptor.layers[0]);
console.log(
  `sprite: ${descriptor.width}x${descriptor.height} @ ${descriptor.fps}fps, ` +
    `${layerData.frameCount} frames, layer "${layerData.name}" (opacity ${layerData.opacity})`
);
assert.equal(descriptor.width, 32);
assert.equal(descriptor.height, 32);
assert.ok(descriptor.fps > 0);

let decoded = 0;
const frames = [];
layerData.chunks.forEach((chunk, ci) => {
  assert.ok(
    chunk.base64PNG.startsWith("data:image/png"),
    `chunk ${ci} is not a PNG data URI`
  );
  assert.equal(
    chunk.base64PNG,
    chunk.base64PNG.trim(),
    `chunk ${ci} has whitespace`
  );
  const image = decodePng(Buffer.from(chunk.base64PNG.split(",")[1], "base64"));
  const chunkFrames = sliceLayout(image, chunk.layout);
  console.log(
    `  chunk ${ci}: ${image.width}x${image.height} px, layout ${JSON.stringify(chunk.layout)} -> ` +
      `frames ${chunkFrames.map((f) => f.index).join(", ")}`
  );
  chunkFrames.forEach((frame) => {
    frames[frame.index] = frame;
    decoded++;
  });
});
assert.equal(
  decoded,
  layerData.frameCount,
  "decoded frame count != layer frameCount"
);

/* Compare the decoded spritesheet frames against the standalone .png. */
const sheet = decodePng(fs.readFileSync(path.join(__dirname, `${NAME}.png`)));
assert.equal(sheet.width, 32 * layerData.frameCount);
assert.equal(sheet.height, 32);
for (let i = 0; i < layerData.frameCount; i++) {
  const frame = frames[i];
  for (let y = 0; y < 32; y++) {
    const a = y * 32 * 4;
    const b = (y * sheet.width + i * 32) * 4;
    assert.ok(
      frame.pixels
        .subarray(a, a + 32 * 4)
        .equals(sheet.pixels.subarray(b, b + 32 * 4)),
      `frame ${i} row ${y} differs from the sheet`
    );
  }
}
console.log(
  `all ${layerData.frameCount} frames decoded and match ${NAME}.png exactly`
);

/* Transparency sanity: frames must have transparent padding around the art. */
for (let i = 0; i < frames.length; i++) {
  const p = frames[i].pixels;
  const opaque = [];
  for (let idx = 0; idx < 32 * 32; idx++) {
    if (p[idx * 4 + 3] > 0) {
      opaque.push([idx % 32, Math.floor(idx / 32)]);
    }
  }
  const xs = opaque.map((o) => o[0]);
  const ys = opaque.map((o) => o[1]);
  const box = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys)
  ];
  assert.ok(
    box[0] > 0 && box[1] > 0 && box[2] < 31 && box[3] < 31,
    `frame ${i} is clipped: ${box}`
  );
  console.log(
    `  frame ${i}: art box x${box[0]}..${box[2]} y${box[1]}..${box[3]}, ${opaque.length} opaque px`
  );
}

console.log("\nOK - transformer-red.piskel is valid and loads cleanly.");
