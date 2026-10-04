# Source provenance

The upstream files come from `libretro/slang-shaders` at
`0b3ff0b240f82f4cb5e5d0117f8f2080e2764cf7`. Their complete file hashes and paths
are in `upstream.lock.json`. Keep their original notices with redistributed source.

CRT Lottes identifies itself as a public-domain shader by Timothy Lottes in
`public/upstream/crt/shaders/crt-lottes.slang`.

CRT Hyllian carries its MIT notice in
`public/upstream/crt/shaders/hyllian/crt-hyllian-base.slang`. The original support
files and Sony Wega LUT PNGs are preserved alongside it. The LUT PNGs have no
per-file license notice in this extraction; establish their redistribution terms
before a public release rather than assigning the project license to them.

The pre-existing TypeGPU implementations were extracted from
`gsimone/glyphbox`, branch `crt-shaders`, commit recorded in
`legacy/provenance.json`. Their original files remain in `legacy/original`.
Generated GLSL in `public/compiled` derives from the corresponding upstream
shader and retains that source's licensing, even when the compiler omits comments.

No blanket public license is assigned to this private development repository.
