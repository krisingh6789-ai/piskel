# Sprites

Hand-generated sprite assets used for testing / showcasing the editor.

## transformer-red

A 32x32 pixel-art red battle mech: crested helmet with a glowing visor, glass
chest windows, blocky pauldrons and chunky boots. 6 frame idle loop (power hum
plus a visor pulse) at 10 fps.

| File | What it is |
| --- | --- |
| `transformer-red.piskel` | The sprite itself, in Piskel model v2 format. Open it with **Import → Browse local files** or drag it onto the editor. |
| `transformer-red.gif` | Animated GIF at 1x (32x32), transparent background, loops forever. |
| `transformer-red-preview.gif` | The same animation at 8x (256x256) on a dark background, for viewing. |
| `transformer-red.png` | Flattened horizontal sprite sheet (192x32), one column per frame. |
| `transformer-red-preview.png` | 8x zoomed strip of all frames, for reviewing the animation. |
| `make-transformer-red.mjs` | Regenerates the `.piskel`, both PNGs and both GIFs. |
| `verify-transformer-red.mjs` | Validates every generated asset (no browser needed). |

Regenerate and verify:

```sh
node misc/sprites/make-transformer-red.mjs                                     # --ascii dumps frame 0 as text
node misc/sprites/piskel-to-gif.mjs misc/sprites/transformer-red.piskel        # 1x, transparent
node misc/sprites/piskel-to-gif.mjs misc/sprites/transformer-red.piskel \
  --scale 8 --background '#262a35' --out misc/sprites/transformer-red-preview.gif
node misc/sprites/verify-transformer-red.mjs
```

## Tools

| File | What it does |
| --- | --- |
| `png.mjs` | Minimal PNG encode/decode, plus nearest-neighbour scaling and alpha flattening. |
| `gif.mjs` | Minimal GIF89a encoder: one global colour table, per-frame transparency, disposal method 2, NETSCAPE looping, hand-rolled LZW. |
| `piskel.mjs` | Reads and writes the `.piskel` format (layer chunks, frame layout). |
| `piskel-to-gif.mjs` | CLI: exports any `.piskel` as an animated GIF (`--scale`, `--fps`, `--background`, `--out`, `--loop`). |

These are plain ESM modules with no image dependencies, so any `.piskel` file
can be converted without the editor:

```sh
node misc/sprites/piskel-to-gif.mjs my-sprite.piskel --scale 4
```

The generator draws the mech from code (blocks, mirrored limbs, a shared
palette) instead of shipping hand-edited pixels, so tweaking a colour or a
proportion is a one-line change. It also encodes its own PNGs, so there are no
image dependencies.

`verify-transformer-red.mjs` re-reads everything that was written:

* the `.piskel` file: `modelVersion` is checked against `src/js/Constants.js`,
  layers and chunks are parsed the way `pskl.utils.serialization.Deserializer`
  does, and frames are sliced with the chunk layout exactly like
  `pskl.utils.FrameUtils.createFramesFromChunk`. Every frame is then compared
  with the standalone `.png` and checked for transparent padding, so nothing is
  clipped by the canvas edge.
* the `.gif` files: re-parsed with the project's own `gifuct-js` dependency, and
  every frame is compared back to the `.piskel` frames pixel for pixel, along
  with size, frame count, delay, disposal method and the looping extension.
