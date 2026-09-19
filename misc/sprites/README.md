# Sprites

Hand-generated sprite assets used for testing / showcasing the editor.

## transformer-red

A 32x32 pixel-art red battle mech: crested helmet with a glowing visor, glass
chest windows, blocky pauldrons and chunky boots. 6 frame idle loop (power hum
plus a visor pulse) at 10 fps.

| File | What it is |
| --- | --- |
| `transformer-red.piskel` | The sprite itself, in Piskel model v2 format. Open it with **Import → Browse local files** or drag it onto the editor. |
| `transformer-red.png` | Flattened horizontal sprite sheet (192x32), one column per frame. |
| `transformer-red-preview.png` | 8x zoomed strip of all frames, for reviewing the animation. |
| `make-transformer-red.mjs` | Regenerates all of the above. |
| `verify-transformer-red.mjs` | Validates the `.piskel` file the same way the editor loads it (no browser needed). |

Regenerate and verify:

```sh
node misc/sprites/make-transformer-red.mjs     # --ascii to dump frame 0 as text
node misc/sprites/verify-transformer-red.mjs
```

The generator draws the mech from code (blocks, mirrored limbs, a shared
palette) instead of shipping hand-edited pixels, so tweaking a colour or a
proportion is a one-line change. It also encodes its own PNGs, so there are no
image dependencies.

`verify-transformer-red.mjs` re-reads the written file: it checks
`modelVersion` against `src/js/Constants.js`, parses each layer and chunk the way
`pskl.utils.serialization.Deserializer` does, slices frames with the chunk
layout exactly like `pskl.utils.FrameUtils.createFramesFromChunk`, and asserts
every frame has transparent padding so nothing is clipped.
