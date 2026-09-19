/**
 * Reading and writing the Piskel (.piskel) file format, model version 2.
 *
 * The layout mirrors the editor's own code so the files round-trip:
 *   src/js/utils/serialization/Serializer.js     (writer)
 *   src/js/utils/serialization/Deserializer.js   (reader)
 *   src/js/utils/FrameUtils.js                   (chunk layout slicing)
 *
 * A .piskel file is plain JSON (no base64 wrapper):
 *   { modelVersion, piskel: { name, description, fps, width, height,
 *                             layers: [ "<json string>" ], hiddenFrames } }
 * where each layer holds `chunks`, and each chunk is a PNG spritesheet plus a
 * `layout` describing which frames its columns map to.
 */
import fs from "node:fs";
import { decodePng, encodePng } from "./png.mjs";

/** Read a .piskel file into an array of RGBA frames, in frame order. */
export function readPiskel(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const descriptor = parsed.piskel;
  const layer = JSON.parse(descriptor.layers[0]);

  const frames = [];
  for (const chunk of layer.chunks) {
    const base64 = chunk.base64PNG.replace(/^data:image\/png;base64,/, "");
    const image = decodePng(Buffer.from(base64, "base64"));
    const frameWidth = image.width / chunk.layout.length;
    const frameHeight = image.height / chunk.layout[0].length;
    if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight)) {
      throw new Error(
        `chunk layout does not divide the spritesheet: ${image.width}x${image.height} / ${JSON.stringify(chunk.layout)}`
      );
    }

    for (let i = 0; i < chunk.layout.length; i++) {
      for (let j = 0; j < chunk.layout[i].length; j++) {
        const pixels = Buffer.alloc(frameWidth * frameHeight * 4);
        for (let y = 0; y < frameHeight; y++) {
          const src =
            ((j * frameHeight + y) * image.width + i * frameWidth) * 4;
          image.pixels.copy(
            pixels,
            y * frameWidth * 4,
            src,
            src + frameWidth * 4
          );
        }
        frames[chunk.layout[i][j]] = {
          width: frameWidth,
          height: frameHeight,
          pixels
        };
      }
    }
  }

  return {
    modelVersion: parsed.modelVersion,
    name: descriptor.name,
    description: descriptor.description,
    fps: descriptor.fps,
    width: descriptor.width,
    height: descriptor.height,
    layerName: layer.name,
    frames
  };
}

/** Append frames side by side into one horizontal RGBA spritesheet. */
export function framesToSheet(frames, width, height) {
  const pixels = Buffer.alloc(width * frames.length * height * 4);
  frames.forEach((frame, index) => {
    for (let y = 0; y < height; y++) {
      frame.pixels.copy(
        pixels,
        (y * width * frames.length + index * width) * 4,
        y * width * 4,
        (y + 1) * width * 4
      );
    }
  });
  return { width: width * frames.length, height, pixels };
}

/**
 * Serialize frames into the two things a .piskel file needs: the JSON text and
 * the spritesheet it embeds. The sheet is also what the editor shows as a PNG.
 *
 * @returns {{ json: string, sheet: { width: number, height: number, pixels: Buffer } }}
 */
export function serializePiskel({
  name,
  description,
  width,
  height,
  fps,
  frames
}) {
  const sheet = framesToSheet(frames, width, height);
  const layer = {
    name: "Layer 1",
    opacity: 1,
    frameCount: frames.length,
    chunks: [
      {
        layout: frames.map((_, index) => [index]),
        base64PNG: `data:image/png;base64,${encodePng(sheet.width, sheet.height, sheet.pixels).toString("base64")}`
      }
    ]
  };

  return {
    json: JSON.stringify({
      modelVersion: 2,
      piskel: {
        name,
        description,
        fps,
        height,
        width,
        layers: [JSON.stringify(layer)],
        hiddenFrames: []
      }
    }),
    sheet
  };
}
