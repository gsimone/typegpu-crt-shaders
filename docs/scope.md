# Private reference project

Extract Lottes and Hyllian from glyphbox's `crt-shaders` branch at `adaf9fd`.
Preserve the original port files, and expose a runnable copy without game dependencies.
Run pinned upstream Slang shader bodies through glslang and SPIRV-Cross, using
the original presets, parameter defaults, pass sizes, sRGB targets, LUTs and sampling.
Accept an image or deterministic diagnostic pattern. Show upstream, existing port,
and an absolute RGB difference image at identical output dimensions.

Pixel-perfect means zero differing RGB bytes. Report maximum error, mean error,
and differing pixels without hiding differences behind a tolerance. Browser/GPU
metadata belongs with exported results. A successful build does not establish
fidelity to RetroArch; reference screenshots from that runtime remain a separate
validation step. Existing ports must not be described as exact until measured.

The build order is pinned sources, upstream runner, extracted port runner, then
comparisons. The comparison app depends on both runners; neither runner depends
on the game. TypeScript uses explicit input/output types and per-instance state.

Commands: `npm ci`, `npm run check`, `npm run dev`. Refresh sources with
`npm run upstream:fetch`; regenerate browser shaders with
`npm run upstream:compile` after installing glslang and SPIRV-Cross.
Tests cover pixel metrics and source integrity; browser checks cover actual GPU
compilation, all passes, LUT readiness, input orientation and image rendering.

This first step stays private. The later public TypeGPU package and glyphbox
migration follow reference validation and parity work. Preserve upstream notices.
Do not carry game assets, unrelated history, or game code into the public package.
