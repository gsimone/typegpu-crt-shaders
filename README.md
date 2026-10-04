# TypeGPU CRT shaders

Private development repo for standalone CRT shader reproductions and TypeGPU ports.
The current app runs **CRT Lottes** and **CRT Hyllian** from pinned upstream Slang
source beside the existing glyphbox ports. It accepts an image, renders both at
the same resolution, and shows their absolute RGB difference.

The existing ports are not pixel-perfect. See [recorded comparisons](docs/baseline.json).
The upstream runner also needs comparison against native RetroArch captures before
we can certify it as a pixel-perfect RetroArch reproduction. This repo records
that distinction instead of treating a successful render as proof of parity.

## Run

Use Node 22.18+ and a browser with WebGL 2 and WebGPU, such as Chromium.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. Select a shader and an output scale, or load an image.
Transparent input is composited over black. The built-in pattern has color bars,
a grayscale ramp, a one-pixel checkerboard, a white edge, and a red orientation
marker. It contains no game assets.

The canvases display at one CSS pixel per output pixel and scroll when needed.
Save PNG exports the full output, regardless of the visible crop. Save comparison
JSON records input hash, dimensions, parameters, upstream revision, GPU information,
and RGB error metrics. Custom upstream parameters render only the reference;
Compare defaults restores shared defaults and renders both implementations.

For this extraction's local preview:

```sh
npm exec -- portless glyphbox-crt-extraction vite --host 127.0.0.1
```

## Verify

```sh
npm run check
```

This runs TypeScript, upstream and extracted-source checksums, generated-source
integrity, tests for pixel metrics and table conversion, and the production build.
GPU rendering needs a real browser. In the dev preview's console, run:

```js
await import('/src/browser-check.ts').then(m => m.checkReferences())
await window.crtLab.compare('hyllian', 3)
```

The browser checks cover RGBA orientation, sRGB target conversion, repeatability,
all 5 Lottes masks, all 18 Hyllian masks, both LUTs and LUT off, glow, and curvature.
No tolerance is applied to the comparison's `exact` result. It requires zero
differing RGB bytes. Mean and maximum errors use the 0–255 byte scale; alpha is
excluded because the rendered image is opaque.

## Source and layout

| Path | Contents |
| --- | --- |
| `public/upstream/` | Unmodified presets, Slang shaders and LUTs from libretro |
| `upstream.lock.json` | Upstream repository, commit and SHA-256 hashes |
| `public/compiled/shaders.json` | Generated ESSL 300 vertex/fragment stages and preset metadata |
| `compiled.lock.json` | Compiler version and hashes tying output to source and conversion scripts |
| `src/reference.ts` | WebGL 2 runner for the original pass graph |
| `legacy/original/` | Byte-for-byte extraction from glyphbox `crt-shaders` at `adaf9fd` |
| `legacy/postfx.ts` | Runnable extraction with per-instance settings and awaited LUT loading |
| `src/port.ts` | Image upload and readback around the existing TypeGPU renderer |
| `src/compare.ts` | RGB metrics and unamplified difference image |

The runnable extraction changes imports and control ownership and exposes LUT
readiness. Its shader math is retained. It has no koota, Effect, game state,
localStorage settings, or glyphbox dependency. The `legacy` directory is evidence
for future porting work, not the proposed public package API.

## Rebuild the references

Install `glslangValidator` and `spirv-cross` on your PATH, then run:

```sh
npm run upstream:fetch
npm run upstream:compile
npm run check
```

Fetch always uses the pinned commit in `scripts/upstream.mjs`. It follows presets,
shader includes and LUT references. It does not fetch a moving branch at runtime.
The generated shaders are committed, so ordinary users need no native compiler.

The compiler splits the original vertex and fragment stages and converts their
SPIR-V to ESSL 300. ESSL 300 lacks multidimensional arrays, so the conversion
script flattens Hyllian's constant mask tables without changing their entries.
Runtime code implements transparent-black texture borders because WebGL does
not offer `clamp_to_border`. It also implements the mipmapped border lookup used
by Hyllian's glow pass. Intermediate sRGB textures use hardware encoding and
decoding; final output is RGBA8, matching the default SDR output contract.

These compatibility steps need independent RetroArch capture validation,
particularly around bilinear borders, mipmap LOD, and GPU rounding. See the
[Slang specification](https://docs.libretro.com/development/shader/slang-shaders/)
and the pinned [upstream presets](https://github.com/libretro/slang-shaders/tree/0b3ff0b240f82f4cb5e5d0117f8f2080e2764cf7/crt).

## Next steps toward a public package

1. Validate reference PNGs against RetroArch with the same source image, viewport,
   preset, and parameter values. Keep the capture configuration with each image.
2. Write standalone TypeGPU implementations against those references, preserving
   pass boundaries and all upstream controls. Investigate every nonzero pixel diff.
3. Define the texture-in/texture-out API and lifetime ownership, then package it
   independently of the comparison app.
4. Verify source and LUT redistribution terms for the public release, retaining
   all upstream attribution. Publish, then migrate glyphbox to the package and
   remove its duplicated shaders.

See [third-party notices](THIRD_PARTY.md). This repository stays private during
reference validation and port development.
