import { createReference, type Preset } from './reference.ts';
import { pattern } from './pattern.ts';
import { compare } from './compare.ts';

export async function checkReferences() {
  const presets = await (await fetch('/compiled/shaders.json')).json() as Record<string, Preset>;
  const results: string[] = [];
  const assert = (condition: boolean, label: string) => { if (!condition) throw new Error(label); results.push(label); };
  const vert = `#version 300 es
    layout(location=0) in vec4 Position; layout(location=1) in vec2 TexCoord;
    out vec2 uv; void main() { gl_Position=Position; uv=TexCoord; }`;
  const frag = `#version 300 es
    precision highp float; uniform sampler2D Source; in vec2 uv;
    out vec4 color; void main() { color=texture(Source,uv); }`;
  const pass = { source: 'test-copy', vert, frag };
  const copy = await createReference({ directory: '', parameters: {}, preset: { wrap_mode0: 'clamp_to_edge' }, passes: [pass] });
  const asymmetric = { width: 2, height: 2, rgba: new Uint8Array([255,0,0,255, 0,255,0,255, 0,0,255,255, 127,127,127,255]) };
  try {
    assert(compare(asymmetric.rgba, copy.render(asymmetric, asymmetric).rgba).metrics.exact, 'RGBA upload and readback preserve channel and row order');
  } finally { copy.dispose(); }
  const srgb = await createReference({ directory: '', parameters: {}, preset: { wrap_mode0: 'clamp_to_edge', wrap_mode1: 'clamp_to_edge', srgb_framebuffer0: 'true' }, passes: [pass, pass] });
  try {
    const error = compare(asymmetric.rgba, srgb.render(asymmetric, asymmetric).rgba).metrics;
    assert(error.maxError <= 1, 'sRGB intermediate encodes and decodes without a second gamma curve');
  } finally { srgb.dispose(); }
  const image = pattern(64, 48);
  const output = { width: 256, height: 192 };
  for (const name of ['lottes', 'hyllian']) {
    const renderer = await createReference(presets[name]);
    try {
      const baseline = renderer.render(image, output);
      assert(compare(baseline.rgba, renderer.render(image, output).rgba).metrics.exact, `${name} repeated frames are byte-identical`);
      const hash = (rgba: Uint8Array) => { let h = 2166136261; for (const b of rgba) h = Math.imul(h ^ b, 16777619); return h >>> 0; };
      const maskKey = name === 'lottes' ? 'shadowMask' : 'PHOSPHOR_LAYOUT';
      const hashes = new Set<number>();
      for (let mask = 0; mask <= (name === 'lottes' ? 4 : 17); mask++) hashes.add(hash(renderer.render(image, output, { [maskKey]: mask }).rgba));
      assert(hashes.size === (name === 'lottes' ? 5 : 18), `${name} every mask renders a distinct image`);
      if (name === 'hyllian') {
        const lut = new Set([0, 1, 2].map((value) => hash(renderer.render(image, output, { LUT_selector_param: value }).rgba)));
        assert(lut.size === 3, 'Hyllian LUT off, warm and cool produce distinct output');
        assert(!compare(baseline.rgba, renderer.render(image, output, { GLOW_ENABLE: 1, GLOW_STRENGTH: 0.5 }).rgba).metrics.exact, 'Hyllian glow passes change the output');
        assert(!compare(baseline.rgba, renderer.render(image, output, { h_curvature: 1, h_radius: 2 }).rgba).metrics.exact, 'Hyllian curvature changes the output');
      }
    } finally { renderer.dispose(); }
  }
  return { passed: results.length, results };
}
