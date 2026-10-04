# Verification record

Checked in T3 Code's collaborative Chromium 152 preview on Apple M1 Pro / Metal.

- All six original passes compile and run. Hyllian executes its complete five-pass
  preset, including LUT, beam, threshold, horizontal glow and final composite.
- Both extracted TypeGPU ports compile and render with TypeGPU 0.12.5.
- Nine browser checks pass. They cover pixel orientation, sRGB round-trip,
  repeatability, every mask, LUT selection, glow and curvature.
- The comparison matrix covers 2×, 2.5×, 3× and 4× output scales for both shaders.
  The input is the deterministic 320×240 diagnostic pattern. Full results and
  environment metadata are in `baseline.json`.

At 3×, Lottes differs at 30,853 of 691,200 pixels, with mean RGB error 4.0007/255.
Hyllian differs at 162,233 pixels, with mean RGB error 0.2302/255. These measure
the old ports against the browser references, not against native RetroArch.
They are starting measurements for port development, not passing parity thresholds.

Pixel-perfect certification remains open until matching native RetroArch
captures exist. The browser compiler's table flattening, border sampler adapter,
mipmap LOD calculation and final-target handling are explicit review points.
GPU-dependent rounding can produce small differences even when formulas match.
