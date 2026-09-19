/**
 * Verifies the generated "Transformer Red" assets without a browser.
 *
 * For the .piskel file it replays the editor's own load path:
 *   - JSON.parse like pskl.utils.PiskelFileUtils.decodePiskelFile
 *   - modelVersion checked against src/js/Constants.js
 *   - layers/chunks walked like pskl.utils.serialization.Deserializer, with
 *     frames sliced by the chunk layout exactly as
 *     pskl.utils.FrameUtils.createFramesFromChunk does
 *
 * For the .gif files it re-parses them with the project's own gifuct-js
 * dependency and compares every frame back to the .piskel frames.
 *
 * Usage: node misc/sprites/verify-transformer-red.mjs
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { decompressFrames, parseGIF } from "gifuct-js";
import { decodePng, flattenRgba, scaleRgba } from "./png.mjs";
import { readPiskel } from "./piskel.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NAME = "transformer-red";

/** GIFs to check, with the options they were exported with. */
const GIF_EXPECTATIONS = [
  { file: `${NAME}.gif`, scale: 1, background: null },
  { file: `${NAME}-preview.gif`, scale: 8, background: "#262a35" }
];

const constantsSrc = fs.readFileSync(
  path.join(__dirname, "../../src/js/Constants.js"),
  "utf8"
);
const expectedModelVersion = Number(
  constantsSrc.match(/MODEL_VERSION\s*[:=]\s*(\d+)/)[1]
);

/* ------------------------------------------------------------------ *
 * 1. the .piskel file
 * ------------------------------------------------------------------ */
const file = path.join(__dirname, `${NAME}.piskel`);
const parsed = JSON.parse(fs.readFileSync(file, "utf8"));

console.log(
  `modelVersion in file: ${parsed.modelVersion} (editor expects ${expectedModelVersion})`
);
assert.equal(
  parsed.modelVersion,
  expectedModelVersion,
  "modelVersion mismatch"
);

const descriptor = parsed.piskel;
const layerData = JSON.parse(descriptor.layers[0]);
console.log(
  `sprite: ${descriptor.width}x${descriptor.height} @ ${descriptor.fps}fps, ` +
    `${layerData.frameCount} frames, layer "${layerData.name}" (opacity ${layerData.opacity})`
);
assert.equal(descriptor.layers.length, 1, "expected a single layer");
assert.ok(descriptor.fps > 0, "fps must be positive");
assert.equal(layerData.opacity, 1);

layerData.chunks.forEach((chunk, index) => {
  assert.ok(
    chunk.base64PNG.startsWith("data:image/png"),
    `chunk ${index} is not a PNG data URI`
  );
  assert.equal(
    chunk.base64PNG,
    chunk.base64PNG.trim(),
    `chunk ${index} has whitespace`
  );
  const image = decodePng(Buffer.from(chunk.base64PNG.split(",")[1], "base64"));
  console.log(
    `  chunk ${index}: ${image.width}x${image.height} px, layout ${JSON.stringify(chunk.layout)}`
  );
});

const piskel = readPiskel(file);
assert.equal(
  piskel.frames.length,
  layerData.frameCount,
  "decoded frame count != layer frameCount"
);
console.log(`all ${piskel.frames.length} frames decoded from the layer chunks`);

/* The embedded sheet and the standalone .png must agree pixel for pixel. */
const sheet = decodePng(fs.readFileSync(path.join(__dirname, `${NAME}.png`)));
assert.equal(sheet.width, piskel.width * piskel.frames.length);
assert.equal(sheet.height, piskel.height);
for (let i = 0; i < piskel.frames.length; i++) {
  const frame = piskel.frames[i];
  for (let y = 0; y < piskel.height; y++) {
    const a = y * piskel.width * 4;
    const b = (y * sheet.width + i * piskel.width) * 4;
    assert.ok(
      frame.pixels
        .subarray(a, a + piskel.width * 4)
        .equals(sheet.pixels.subarray(b, b + piskel.width * 4)),
      `frame ${i} row ${y} differs from the sheet`
    );
  }
}
console.log(`every frame matches ${NAME}.png exactly`);

/* Transparency sanity: no frame may be clipped by the canvas edge. */
for (let i = 0; i < piskel.frames.length; i++) {
  const { pixels } = piskel.frames[i];
  const xs = [];
  const ys = [];
  for (let index = 0; index < piskel.width * piskel.height; index++) {
    if (pixels[index * 4 + 3] === 0) {
      continue;
    }
    xs.push(index % piskel.width);
    ys.push(Math.floor(index / piskel.width));
  }
  const box = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys)
  ];
  assert.ok(
    box[0] > 0 &&
      box[1] > 0 &&
      box[2] < piskel.width - 1 &&
      box[3] < piskel.height - 1,
    `frame ${i} is clipped: ${box}`
  );
  console.log(
    `  frame ${i}: art box x${box[0]}..${box[2]} y${box[1]}..${box[3]}, ${xs.length} opaque px`
  );
}

/* ------------------------------------------------------------------ *
 * 2. the .gif exports
 * ------------------------------------------------------------------ */
const expectedDelayCs = Math.max(2, Math.round(100 / piskel.fps));

for (const { file: gifFile, scale, background } of GIF_EXPECTATIONS) {
  const gifPath = path.join(__dirname, gifFile);
  if (!fs.existsSync(gifPath)) {
    console.warn(`  (skipped ${gifFile}: not generated)`);
    continue;
  }

  const buffer = fs.readFileSync(gifPath);
  assert.equal(
    buffer.toString("ascii", 0, 6),
    "GIF89a",
    `${gifFile} is not a GIF89a file`
  );
  const parsedGif = parseGIF(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    )
  );
  const gifFrames = decompressFrames(parsedGif, true);

  const width = piskel.width * scale;
  const height = piskel.height * scale;
  assert.equal(parsedGif.lsd.width, width, `${gifFile}: wrong width`);
  assert.equal(parsedGif.lsd.height, height, `${gifFile}: wrong height`);
  assert.equal(
    gifFrames.length,
    piskel.frames.length,
    `${gifFile}: wrong frame count`
  );
  // gifuct-js stores its application-extension entry as an empty frame, so
  // count the real image descriptors as well.
  const imageDescriptors = parsedGif.frames.filter(
    (frame) => frame.image
  ).length;
  assert.equal(
    imageDescriptors,
    piskel.frames.length,
    `${gifFile}: ${imageDescriptors} image descriptors, expected ${piskel.frames.length}`
  );

  // Looping is declared by the NETSCAPE2.0 application extension; gifuct-js
  // does not surface it, so read it straight out of the byte stream.
  const netscapeAt = buffer.indexOf(Buffer.from("NETSCAPE2.0", "ascii"));
  assert.ok(
    netscapeAt > 0,
    `${gifFile}: missing the netscape looping extension`
  );
  const loopBlock = netscapeAt + "NETSCAPE2.0".length;
  assert.equal(buffer[loopBlock], 0x03, `${gifFile}: malformed loop sub-block`);
  assert.equal(
    buffer[loopBlock + 1],
    0x01,
    `${gifFile}: malformed loop sub-block`
  );
  const loopCount = buffer.readUInt16LE(loopBlock + 2);
  assert.equal(
    buffer[loopBlock + 4],
    0x00,
    `${gifFile}: unterminated loop sub-block`
  );

  // What each frame should look like, given how the export was configured.
  const expectedFrames = piskel.frames.map((frame) => {
    let expected = frame;
    if (background) {
      expected = flattenRgba(expected, background);
    }
    if (scale > 1) {
      expected = scaleRgba(expected, scale);
    }
    return expected;
  });

  gifFrames.forEach((gifFrame, index) => {
    // gifuct-js reports delays in milliseconds, the file stores centiseconds
    assert.equal(
      gifFrame.delay,
      expectedDelayCs * 10,
      `${gifFile}: frame ${index} delay`
    );
    assert.equal(
      gifFrame.disposalType,
      2,
      `${gifFile}: frame ${index} disposal type`
    );
    assert.equal(
      gifFrame.dims.width,
      width,
      `${gifFile}: frame ${index} width`
    );
    assert.equal(
      gifFrame.dims.height,
      height,
      `${gifFile}: frame ${index} height`
    );

    const expected = expectedFrames[index];
    let mismatched = 0;
    for (let i = 0; i < width * height; i++) {
      const actualAlpha = gifFrame.patch[i * 4 + 3];
      const expectedAlpha = expected.pixels[i * 4 + 3];
      if (expectedAlpha === 0) {
        // transparent pixel: it must be drawn with the transparent index
        if (actualAlpha !== 0) {
          mismatched++;
        }
        continue;
      }
      if (
        gifFrame.patch[i * 4] !== expected.pixels[i * 4] ||
        gifFrame.patch[i * 4 + 1] !== expected.pixels[i * 4 + 1] ||
        gifFrame.patch[i * 4 + 2] !== expected.pixels[i * 4 + 2]
      ) {
        mismatched++;
      }
    }
    assert.equal(
      mismatched,
      0,
      `${gifFile}: frame ${index} has ${mismatched} mismatched pixels`
    );
  });

  const colours = new Set();
  piskel.frames.forEach((frame) => {
    for (let i = 0; i < piskel.width * piskel.height; i++) {
      if (frame.pixels[i * 4 + 3] === 0) {
        continue;
      }
      colours.add(
        (frame.pixels[i * 4] << 16) |
          (frame.pixels[i * 4 + 1] << 8) |
          frame.pixels[i * 4 + 2]
      );
    }
  });

  console.log(
    `${gifFile}: ${parsedGif.lsd.width}x${parsedGif.lsd.height}, ${gifFrames.length} frames, ` +
      `${gifFrames[0].delay}ms/frame (~${(1000 / gifFrames[0].delay).toFixed(1)}fps), ` +
      `${colours.size} colours${background ? `, background ${background}` : ", transparent"}, ` +
      `loops ${loopCount === 0 ? "forever" : `${loopCount}x`}, ` +
      `${(buffer.length / 1024).toFixed(1)} kB - all frames match`
  );
}

console.log(`\nOK - ${NAME} assets are valid and load cleanly.`);
