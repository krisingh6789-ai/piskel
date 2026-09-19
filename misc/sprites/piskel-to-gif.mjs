#!/usr/bin/env node
/**
 * Exports a .piskel file as an animated GIF.
 *
 * Usage:
 *   node misc/sprites/piskel-to-gif.mjs <file.piskel> [options]
 *
 * Options:
 *   --out <path>       output path (default: input name with a .gif extension)
 *   --scale <n>        nearest-neighbour zoom factor, default 1
 *   --fps <n>          override the frame rate stored in the file
 *   --background <hex> composite onto a solid colour instead of transparency
 *   --loop <n>         0 (default) loops forever
 *
 * Examples:
 *   node misc/sprites/piskel-to-gif.mjs misc/sprites/transformer-red.piskel
 *   node misc/sprites/piskel-to-gif.mjs misc/sprites/transformer-red.piskel \
 *     --scale 8 --background '#262a35' --out preview.gif
 */
import fs from "node:fs";
import path from "node:path";
import minimist from "minimist";
import { encodeGif } from "./gif.mjs";
import { readPiskel } from "./piskel.mjs";
import { flattenRgba, scaleRgba } from "./png.mjs";

const args = minimist(process.argv.slice(2), {
  default: { scale: 1, loop: 0 },
  string: ["out", "background"]
});

const input = args._[0];
if (!input) {
  console.error("Path to a .piskel file is required");
  process.exit(1);
}
if (!fs.existsSync(input)) {
  console.error(`No such file: ${input}`);
  process.exit(1);
}

const scale = Number(args.scale);
if (!Number.isInteger(scale) || scale < 1) {
  console.error(`--scale must be a positive integer, got ${args.scale}`);
  process.exit(1);
}

const piskel = readPiskel(input);
const fps = args.fps ? Number(args.fps) : piskel.fps;
if (!(fps > 0)) {
  console.error(`Invalid frame rate: ${fps}`);
  process.exit(1);
}

// GIF delays are in centiseconds; keep the timeline as close as possible.
const delayCs = Math.max(2, Math.round(100 / fps));

let frames = piskel.frames;
if (args.background) {
  frames = frames.map((frame) => flattenRgba(frame, args.background));
}
if (scale > 1) {
  frames = frames.map((frame) => scaleRgba(frame, scale));
}

const gif = encodeGif({
  width: piskel.width * scale,
  height: piskel.height * scale,
  frames,
  delayCs,
  loop: Number(args.loop) || 0
});

const out = args.out || `${path.basename(input, path.extname(input))}.gif`;
fs.writeFileSync(out, gif);

const sheet = `${piskel.width * scale}x${piskel.height * scale}`;
const transparency = args.background
  ? `background ${args.background}`
  : "transparent";
console.log(
  `Wrote ${out} (${sheet}, ${frames.length} frames, ${fps}fps -> ${delayCs}cs/frame, ${transparency}, ` +
    `${(gif.length / 1024).toFixed(1)} kB)`
);
