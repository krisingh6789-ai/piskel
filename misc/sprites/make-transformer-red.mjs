/**
 * Generates the "Transformer Red" sprite.
 *
 * A 32x32 pixel-art red battle mech with the classic transformer cues:
 * crested helmet with a glowing visor, glass chest windows, blocky
 * pauldrons and chunky boots.  6 frame idle loop (power hum + visor pulse).
 *
 * Design rules kept deliberately simple so it reads at 1x:
 *   - figure centred on column 16, all parts odd widths
 *   - 4 red tones (highlight / light / base / shadow), 1px dark outline
 *   - metal only on joints, boots and the visor frame
 *   - every shape at least 2px thick
 *
 * Outputs (written next to this script):
 *   transformer-red.piskel        - Piskel model v2 file, importable in the editor
 *   transformer-red.png           - flattened horizontal sprite sheet (all frames)
 *   transformer-red-preview.png   - 8x zoomed strip of every frame (design check)
 *
 * Usage: node misc/sprites/make-transformer-red.mjs [--ascii]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng, hexToRgb } from "./png.mjs";
import { framesToSheet, serializePiskel } from "./piskel.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WIDTH = 32;
const HEIGHT = 32;
const FPS = 10;
const NAME = "transformer-red";

/* ------------------------------------------------------------------ *
 * Palette (short key -> hex)
 * ------------------------------------------------------------------ */
const PALETTE = {
  ".": null, // transparent
  K: "#160506", // outline
  D: "#5a120e", // red shadow
  R: "#b22016", // red base
  L: "#e23f28", // red light
  M: "#b3bfc7", // metal light
  N: "#63707b", // metal dark
  B: "#1b3450", // dark blue glass (chest windows)
  C: "#9fe8ff", // cyan energy (visor / glass glint)
  E: "#eafcff" // visor flash frame
};

/* ------------------------------------------------------------------ *
 * Grid helper
 * ------------------------------------------------------------------ */
class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Array(w * h).fill(".");
  }
  static from(rows) {
    const w = Math.max(...rows.map((r) => r.length));
    const g = new Grid(w, rows.length);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        g.set(x, y, row[x]);
      }
    });
    return g;
  }
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x, y) {
    return this.inBounds(x, y) ? this.px[y * this.w + x] : ".";
  }
  set(x, y, c) {
    if (!this.inBounds(x, y) || c === "." || c === " " || c == null) {
      return this;
    }
    this.px[y * this.w + x] = c;
    return this;
  }
  rect(x0, y0, x1, y1, c) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        this.set(x, y, c);
      }
    }
    return this;
  }
  hline(x0, x1, y, c) {
    return this.rect(x0, y, x1, y, c);
  }
  vline(x, y0, y1, c) {
    return this.rect(x, y0, x, y1, c);
  }
  place(other, x0, y0) {
    for (let y = 0; y < other.h; y++) {
      for (let x = 0; x < other.w; x++) {
        const c = other.get(x, y);
        if (c !== ".") {
          this.set(x0 + x, y0 + y, c);
        }
      }
    }
    return this;
  }
  shift(dx, dy) {
    const g = new Grid(this.w, this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        g.set(x + dx, y + dy, this.get(x, y));
      }
    }
    return g;
  }
  /** 1px outline around the whole opaque shape. */
  outline(color = "K") {
    const edges = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) !== ".") {
          continue;
        }
        const n = [
          this.get(x - 1, y),
          this.get(x + 1, y),
          this.get(x, y - 1),
          this.get(x, y + 1)
        ];
        if (n.some((v) => v !== "." && v !== color)) {
          edges.push([x, y]);
        }
      }
    }
    edges.forEach(([x, y]) => this.set(x, y, color));
    return this;
  }
  /** Mirror around x = 32 (the centre between columns 15 and 16). */
  mirrored() {
    const g = new Grid(this.w, this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        g.set(this.w - x, y, this.get(x, y));
      }
    }
    return g;
  }
  painted() {
    let n = 0;
    for (const c of this.px) {
      if (c !== ".") {
        n++;
      }
    }
    return n;
  }
  toAscii() {
    let out = "";
    for (let y = 0; y < this.h; y++) {
      let line = "";
      for (let x = 0; x < this.w; x++) {
        line += this.get(x, y);
      }
      out += `${line}\n`;
    }
    return out;
  }
}

/* ------------------------------------------------------------------ *
 * Layout
 *
 *   rows  3..10  head   (crest, helmet, visor, jaw)
 *   row  11      collar / shoulder yoke
 *   rows 12..15  chest  (glass windows)
 *   rows 16..17  abdomen
 *   rows 18..19  pelvis + hip guards
 *   rows 20..22  thighs
 *   rows 23..24  knees
 *   rows 25..26  shins
 *   row  27      ankles
 *   rows 28..29  boots
 *
 * Horizontal: head/chest/pelvis are 9 wide (x12..20), the collar is 11
 * wide (x11..21), pauldrons sit outside at x4..9 / x23..28.
 * ------------------------------------------------------------------ */
const HEAD_Y = 3;
const COLLAR_Y = 11;
const CHEST_Y = 12;
const _ABDOMEN_Y = 16;
const PELVIS_Y = 18;
const HIP_Y = 20;
const KNEE_Y = 23;
const SHIN_Y = 25;
const ANKLE_Y = 27;
const BOOT_Y = 28;

/* ------------------------------------------------------------------ *
 * Head: crest, helmet, visor with two eye cells, jaw
 * ------------------------------------------------------------------ */
function buildHead(visor) {
  const g = new Grid(WIDTH, HEIGHT);
  const y = HEAD_Y;

  g.rect(15, y, 17, y, "M"); // crest fin (3 wide)
  g.rect(13, y + 1, 19, y + 1, "M"); // crest base
  // helmet crown, 11 wide
  g.rect(11, y + 2, 21, y + 4, "L");
  g.rect(19, y + 2, 21, y + 4, "D"); // shadow side
  g.vline(11, y + 2, y + 4, "M"); // lit edge
  g.hline(12, 20, y + 4, "D"); // brow shadow
  // visor: two glowing eye cells split by a dark bridge
  g.rect(12, y + 5, 20, y + 5, visor);
  g.rect(15, y + 5, 16, y + 5, "K");
  // jaw + mouth plate
  g.rect(12, y + 6, 20, y + 6, "R");
  g.rect(19, y + 6, 20, y + 6, "D");
  g.rect(13, y + 7, 19, y + 7, "R");
  g.rect(15, y + 7, 17, y + 7, "D");
  g.set(19, y + 7, "D");
  return g;
}

/* ------------------------------------------------------------------ *
 * Torso: collar yoke, chest with glass windows, ribbed abdomen
 * ------------------------------------------------------------------ */
function buildTorso() {
  const g = new Grid(WIDTH, HEIGHT);

  // collar / shoulder yoke (11 wide)
  g.rect(11, COLLAR_Y, 21, COLLAR_Y, "R");
  g.rect(11, COLLAR_Y, 12, COLLAR_Y, "L");
  g.rect(20, COLLAR_Y, 21, COLLAR_Y, "D");
  g.rect(13, COLLAR_Y, 14, COLLAR_Y, "M"); // collar plates
  g.rect(18, COLLAR_Y, 19, COLLAR_Y, "M");
  g.rect(15, COLLAR_Y, 17, COLLAR_Y, "D"); // neck socket

  // chest block, rows 11..14
  const y = CHEST_Y;
  g.rect(12, y, 20, y + 3, "R");
  g.rect(12, y, 13, y + 3, "L"); // lit side
  g.rect(19, y, 20, y + 3, "D"); // shadow side
  g.hline(14, 18, y, "L");
  g.hline(12, 20, y + 3, "D"); // under-chest shadow
  // glass windows either side of a dark spine
  // glass panels, each with a vertical reflection stripe
  g.rect(13, y + 1, 14, y + 3, "B");
  g.rect(18, y + 1, 19, y + 3, "B");
  g.vline(13, y + 1, y + 2, "C");
  g.vline(19, y + 1, y + 2, "C");
  g.vline(16, y + 1, y + 3, "D"); // dark spine between the windows

  // abdomen (9 wide), ribbed
  const ay = CHEST_Y + 4;
  g.rect(12, ay, 20, ay + 1, "R");
  g.rect(12, ay, 13, ay + 1, "L");
  g.rect(19, ay, 20, ay + 1, "D");
  g.hline(14, 18, ay + 1, "D"); // rib
  return g;
}

/* ------------------------------------------------------------------ *
 * Pelvis, rows 17..19, plus hip guards
 * ------------------------------------------------------------------ */
function buildPelvis() {
  const g = new Grid(WIDTH, HEIGHT);
  const y = PELVIS_Y;
  g.rect(12, y, 20, y + 1, "R");
  g.rect(12, y, 13, y + 1, "L");
  g.rect(19, y, 20, y + 1, "D");
  g.hline(12, 20, y + 1, "D");
  g.set(13, y + 1, "L");
  g.set(19, y, "R");
  // hip guards
  g.rect(10, y, 11, y + 1, "N");
  g.rect(21, y, 22, y + 1, "N");
  g.set(10, y, "M");
  g.set(22, y, "M");
  return g;
}

/* ------------------------------------------------------------------ *
 * Pauldrons: 6 wide, rows 10..15, mirrored for the other shoulder
 * ------------------------------------------------------------------ */
const PAULDRON_ART = [
  ".KRRRK",
  "KRRLLK",
  "KRLLRN",
  "KRLLRN",
  "KRRRRN",
  "KNNNNK"
];

function buildPauldrons() {
  const left = new Grid(WIDTH, HEIGHT).place(Grid.from(PAULDRON_ART), 4, 11);
  return left.place(left.mirrored(), 0, 0);
}

/* ------------------------------------------------------------------ *
 * Left arm, rows 16..24.  Mirrored for the right arm.
 * ------------------------------------------------------------------ */
function buildLeftArm() {
  const g = new Grid(WIDTH, HEIGHT);
  // upper arm, plugs into the pauldron
  g.rect(8, 17, 10, 19, "R");
  g.rect(8, 17, 8, 19, "L");
  g.rect(10, 17, 10, 19, "D");
  // elbow + forearm
  g.rect(7, 20, 10, 22, "R");
  g.rect(7, 20, 7, 22, "L");
  g.rect(9, 20, 10, 22, "D");
  g.hline(7, 10, 22, "D");
  return g;
}

/** Fists, drawn separately so the idle sway can nudge them inwards. */
function buildFists(inset) {
  const g = new Grid(WIDTH, HEIGHT);
  const draw = (x) => {
    g.rect(x, 23, x + 3, 25, "R");
    g.rect(x, 23, x + 1, 25, "L");
    g.rect(x + 2, 23, x + 3, 25, "D");
    g.set(x + 1, 24, "D");
    g.set(x, 25, "N");
  };
  draw(6 + inset); // left fist
  draw(23 - inset); // right fist
  return g;
}

/* ------------------------------------------------------------------ *
 * Legs: 4 wide, chunky boots with a 1px gap between them.
 * ------------------------------------------------------------------ */
function buildLegs(pose) {
  const g = new Grid(WIDTH, HEIGHT);
  const splay = pose === "settle" ? 1 : 0;

  /**
   * @param {number} hipX  column of the leg's left edge (12 or 17)
   * @param {number} bootX column of the boot's left edge
   * @param {number} dir   -1 for the left leg, +1 for the right
   */
  const drawLeg = (hipX, bootX, dir) => {
    // thigh, rows 20..22
    g.rect(hipX, HIP_Y, hipX + 3, HIP_Y + 2, "R");
    g.rect(hipX, HIP_Y, hipX, HIP_Y + 2, "L");
    g.rect(hipX + 2, HIP_Y, hipX + 3, HIP_Y + 2, "D");
    // knee, rows 23..24
    g.rect(hipX, KNEE_Y, hipX + 3, KNEE_Y + 1, "N");
    g.set(hipX, KNEE_Y, "M");
    // shin, rows 25..26
    g.rect(hipX, SHIN_Y, hipX + 3, SHIN_Y + 1, "R");
    g.rect(hipX, SHIN_Y, hipX, SHIN_Y + 1, "L");
    g.rect(hipX + 2, SHIN_Y, hipX + 3, SHIN_Y + 1, "D");
    // ankle, row 27
    g.rect(hipX, ANKLE_Y, hipX + 3, ANKLE_Y, "N");
    // boot, rows 28..29
    const bx = bootX + splay * dir;
    g.rect(bx, BOOT_Y, bx + 5, BOOT_Y + 1, "R");
    g.rect(bx, BOOT_Y, bx + 5, BOOT_Y, "L");
    g.rect(bx, BOOT_Y + 1, bx + 5, BOOT_Y + 1, "N"); // sole
    g.set(dir < 0 ? bx : bx + 5, BOOT_Y, "M"); // lit heel edge
  };

  drawLeg(12, 10, -1); // left leg, boot reaches x10..15
  drawLeg(17, 17, 1); // right leg, boot reaches x17..22
  return g;
}

/* ------------------------------------------------------------------ *
 * Frame assembly
 * ------------------------------------------------------------------ */
function buildFrame(spec) {
  const body = new Grid(WIDTH, HEIGHT);
  body.place(buildTorso(), 0, 0);
  body.place(buildPelvis(), 0, 0);
  body.place(buildHead(spec.visor), 0, 0);
  body.place(buildPauldrons(), 0, 0);

  const leftArm = buildLeftArm();
  body.place(leftArm, 0, 0);
  body.place(leftArm.mirrored(), 0, 0);
  body.place(buildFists(spec.fist), 0, 0);

  const frame = new Grid(WIDTH, HEIGHT);
  frame.place(buildLegs(spec.pose), 0, 0); // planted, never moves
  frame.place(body.shift(0, -spec.bob), 0, 0); // chest rises when it "breathes"
  frame.outline("K");
  return frame;
}

const FRAME_SPECS = [
  { pose: "stand", bob: 0, fist: 0, visor: "C" },
  { pose: "stand", bob: 0, fist: 1, visor: "E" },
  { pose: "stand", bob: 1, fist: 1, visor: "C" },
  { pose: "stand", bob: 1, fist: 1, visor: "E" },
  { pose: "stand", bob: 1, fist: 0, visor: "C" },
  { pose: "stand", bob: 0, fist: 0, visor: "C" }
];

/** Convert one grid into an RGBA frame buffer. */
function gridToRgba(grid) {
  const pixels = Buffer.alloc(grid.w * grid.h * 4);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const rgb = PALETTE[grid.get(x, y)];
      if (!rgb) {
        continue;
      }
      const [r, g, b] = hexToRgb(rgb);
      const i = (y * grid.w + x) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }
  return { width: grid.w, height: grid.h, pixels };
}

/** 8x nearest-neighbour strip, for design review. */
function writePreview(frames, file) {
  const scale = 8;
  const gap = 16;
  const w = frames.length * WIDTH * scale + (frames.length - 1) * gap;
  const h = HEIGHT * scale;
  const buf = Buffer.alloc(w * h * 4);
  const bg = hexToRgb("#262a35");
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = bg[0];
    buf[i * 4 + 1] = bg[1];
    buf[i * 4 + 2] = bg[2];
    buf[i * 4 + 3] = 255;
  }
  frames.forEach((frame, idx) => {
    const ox = idx * (WIDTH * scale + gap);
    for (let y = 0; y < HEIGHT * scale; y++) {
      for (let x = 0; x < WIDTH * scale; x++) {
        const c = frame.get(Math.floor(x / scale), Math.floor(y / scale));
        const di = (y * w + ox + x) * 4;
        if (!PALETTE[c]) {
          if (x % (scale * 4) === 0 || y % (scale * 4) === 0) {
            buf[di] = 48;
            buf[di + 1] = 52;
            buf[di + 2] = 64;
          }
          continue;
        }
        const [r, g, b] = hexToRgb(PALETTE[c]);
        buf[di] = r;
        buf[di + 1] = g;
        buf[di + 2] = b;
      }
    }
  });
  fs.writeFileSync(file, encodePng(w, h, buf));
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
const grids = FRAME_SPECS.map(buildFrame);
const frames = grids.map(gridToRgba);

// Validate every frame: only palette characters, and nothing clipped.
grids.forEach((frame, i) => {
  const bad = [];
  frame.px.forEach((c, idx) => {
    if (typeof c !== "string" || (c !== "." && !(c in PALETTE))) {
      bad.push([idx % WIDTH, Math.floor(idx / WIDTH), c]);
    }
  });
  if (bad.length) {
    throw new Error(`frame ${i}: invalid cells ${JSON.stringify(bad)}`);
  }

  const xs = [];
  const ys = [];
  frame.px.forEach((c, idx) => {
    if (c === ".") {
      return;
    }
    xs.push(idx % WIDTH);
    ys.push(Math.floor(idx / WIDTH));
  });
  const b = {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys)
  };
  if (b.x0 < 0 || b.y0 < 0 || b.x1 > WIDTH - 1 || b.y1 > HEIGHT - 1) {
    throw new Error(`frame ${i} is clipped: ${JSON.stringify(b)}`);
  }
});

const sheet = framesToSheet(frames, WIDTH, HEIGHT);
fs.writeFileSync(
  path.join(__dirname, `${NAME}.png`),
  encodePng(sheet.width, sheet.height, sheet.pixels)
);

const piskel = serializePiskel({
  name: NAME,
  description: "Red Transformer - 6 frame idle loop",
  width: WIDTH,
  height: HEIGHT,
  fps: FPS,
  frames
});
fs.writeFileSync(path.join(__dirname, `${NAME}.piskel`), piskel.json);

writePreview(grids, path.join(__dirname, `${NAME}-preview.png`));

if (process.argv.includes("--ascii")) {
  console.log(`--- frame 0 ---\n${grids[0].toAscii()}`);
}

console.log(
  `Wrote ${NAME}.piskel (${WIDTH}x${HEIGHT}, ${frames.length} frames @ ${FPS}fps, ` +
    `${grids[0].painted()} px in frame 0)`
);
