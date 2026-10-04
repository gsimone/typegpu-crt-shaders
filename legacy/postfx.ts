import tgpu, { common, d, std, type TgpuRoot } from 'typegpu';
import { createControls } from './controls.ts';
import { decodePng } from './png.ts';

export const CrtParams = d.struct({
  /** Physical pixel offset/size of the letterboxed content rectangle. */
  offset: d.vec2f,
  content: d.vec2f,
  /** Physical pixels per virtual pixel. */
  scale: d.f32,
  time: d.f32,
  flash: d.f32,
  fade: d.f32,
  warpX: d.f32,
  warpY: d.f32,
  glow: d.f32,
  bright: d.f32,
  hardScan: d.f32,
  hardPix: d.f32,
  shape: d.f32,
  lottesMask: d.f32,
  maskDark: d.f32,
  maskLight: d.f32,
  lottesBloom: d.f32,
  beamMin: d.f32,
  beamMax: d.f32,
  scanlines: d.f32,
  soft: d.f32,
  hyllianMask: d.f32,
  maskStrength: d.f32,
  subpixels: d.f32,
  hCurvature: d.f32,
  hShape: d.f32,
  hRadius: d.f32,
  hCornerSize: d.f32,
  hCornerSmooth: d.f32,
  lut: d.f32,
  ours: d.f32,
});

export interface PostFxOptions {
  readonly width: number;
  readonly height: number;
  readonly surfaceFormat: GPUTextureFormat;
}

const hash = (p: d.v2f): number => {
  'use gpu';
  return std.fract(std.sin(std.dot(p, d.vec2f(12.9898, 78.233))) * 43758.5453);
};

/** `x mod n` for whole-numbered x (fract(x / n) * n drifts off the integers). */
const wrap = (x: number, n: number): number => {
  'use gpu';
  return x - n * std.floor(x / n);
};

/** The scene holds display values (sRGB): the ports filter in light, and go back at the end. Lottes' ToLinear and ToSrgb. */
const toLinear = (c: d.v3f): d.v3f => {
  'use gpu';
  return std.select(std.pow(c.add(0.055).div(1.055), d.vec3f(2.4)), c.div(12.92), std.le(c, d.vec3f(0.04045)));
};
const toSrgb = (c: d.v3f): d.v3f => {
  'use gpu';
  return std.select(std.pow(c, d.vec3f(0.41666)).mul(1.055).sub(0.055), c.mul(12.92), std.lt(c, d.vec3f(0.0031308)));
};

/** One phosphor of three lit: red under a third, green under two, blue past that. */
const stripe = (x: number, dark: number, light: number): d.v3f => {
  'use gpu';
  return d.vec3f(std.select(dark, light, x < 0.333), std.select(dark, light, x >= 0.333 && x < 0.666), std.select(dark, light, x >= 0.666));
};
const rgbAt = (i: number): d.v3f => {
  'use gpu';
  return d.vec3f(std.select(0, 1, i < 0.5), std.select(0, 1, i > 0.5 && i < 1.5), std.select(0, 1, i > 1.5));
};
const magentaGreen = (i: number): d.v3f => {
  'use gpu';
  return std.select(d.vec3f(1, 0, 1), d.vec3f(0, 1, 0), i > 0.5);
};

export const createPostFx = (root: TgpuRoot, opts: PostFxOptions) => {
  const controls = createControls();
  const tweak = controls.tweak;
/**
 * Which CRT composite draws the frame: the original, or a port of one of libretro's
 * (slang-shaders/crt): Timothy Lottes' crt-lottes (public domain) or Hyllian's
 * crt-hyllian (MIT, Copyright (C) 2011-2024 Hyllian). Both keep their parameter names.
 */
const CRT_SHADER = tweak('crt', 'shader', 2, { options: ['old', 'lottes', 'hyllian'] });
/** Ours, not the shaders': black level, vignette, flicker, grain, the tube's edge, and masks fading out below 3x. */
const OURS = tweak('crt', 'our effects', 0, { options: ['off', 'on'] });
const GLOW = tweak('crt', 'extra glow (not old)', 0, { min: 0, max: 1.5 });
const BRIGHT = tweak('crt', 'brightBoost (not old)', 1, { min: 0.5, max: 2 });
const WARP_X = tweak('crt lottes', 'warpX', 0.031, { min: 0, max: 0.125, step: 0.001 });
const WARP_Y = tweak('crt lottes', 'warpY', 0.041, { min: 0, max: 0.125, step: 0.001 });
const HARD_SCAN = tweak('crt lottes', 'hardScan', -8, { min: -20, max: 0, step: 0.5 });
const HARD_PIX = tweak('crt lottes', 'hardPix', -3, { min: -20, max: 0, step: 0.5 });
const SHAPE = tweak('crt lottes', 'shape', 2, { min: 0.5, max: 10, step: 0.05 });
const LOTTES_MASK = tweak('crt lottes', 'mask', 3, { options: ['off', 'tv', 'aperture grille', 'stretched vga', 'vga'] });
const MASK_DARK = tweak('crt lottes', 'maskDark', 0.5, { min: 0, max: 2, step: 0.05 });
const MASK_LIGHT = tweak('crt lottes', 'maskLight', 1.5, { min: 0, max: 2, step: 0.05 });
const LOTTES_BLOOM = tweak('crt lottes', 'bloomAmount (31 taps)', 0.15, { min: 0, max: 1, step: 0.05 });
const BEAM_MIN = tweak('crt hyllian', 'BEAM_MIN_WIDTH', 0.72, { min: 0, max: 1 });
const BEAM_MAX = tweak('crt hyllian', 'BEAM_MAX_WIDTH', 1, { min: 0, max: 1 });
const SCANLINES = tweak('crt hyllian', 'SCANLINES_STRENGTH', 0.72, { min: 0, max: 1 });
const SOFT = tweak('crt hyllian', 'SCANLINES_SHAPE', 1, { options: ['sharp', 'soft'] });
const HYLLIAN_MASK = tweak('crt hyllian', 'mask', 1, { options: ['none (still brightens)', 'aperture 2px', 'aperture 3px', 'aperture 4px (4k)', 'dot', 'slot'] });
const MASK_STRENGTH = tweak('crt hyllian', 'MASK_STRENGTH', 1, { min: 0, max: 1 });
const SUBPIXELS = tweak('crt hyllian', 'MONITOR_SUBPIXELS', 0, { options: ['RGB', 'BGR'] });
const H_CURVATURE = tweak('crt hyllian', 'h_curvature', 0, { options: ['off', 'on'] });
const H_SHAPE = tweak('crt hyllian', 'h_shape', 0, { options: ['sphere', 'cylinder'] });
const H_RADIUS = tweak('crt hyllian', 'h_radius', 5, { min: 1.5, max: 10, step: 0.1 });
const H_CORNER_SIZE = tweak('crt hyllian', 'h_cornersize', 0.04, { min: 0.01, max: 1 });
const H_CORNER_SMOOTH = tweak('crt hyllian', 'h_cornersmooth', 0.5, { min: 0.1, max: 1, step: 0.1 });
const LUT = tweak('crt hyllian', 'LUT_selector_param', 1, { options: ['off', 'dark blue', 'dark blue (cool)'] });
/** Hyllian's LUT_Size: each LUT is 32 slices of 32x32. */
const LUT_SIZE = 32;
/** Hyllian's H_MaskGamma: how hard a lit phosphor brightens. */
const HYLLIAN_MASK_GAMMA = 2.4;
/** Lottes' bloom kernel (hardBloomPix, hardBloomScan). */
const BLOOM_PIX = -1.5;
const BLOOM_SCAN = -2;
/** The tweaks CrtParams carries, in its order (after `fade`). */
const TWEAKED = [
  WARP_X, WARP_Y, GLOW, BRIGHT, HARD_SCAN, HARD_PIX, SHAPE, LOTTES_MASK, MASK_DARK, MASK_LIGHT, LOTTES_BLOOM,
  BEAM_MIN, BEAM_MAX, SCANLINES, SOFT, HYLLIAN_MASK, MASK_STRENGTH, SUBPIXELS, H_CURVATURE, H_SHAPE, H_RADIUS, H_CORNER_SIZE, H_CORNER_SMOOTH,
  LUT, OURS,
];


  const W = opts.width;
  const H = opts.height;
  const HW = Math.floor(W / 2);
  const HH = Math.floor(H / 2);
  const vsize = d.vec2f(W, H);

  const scene = root.createTexture({ size: [W, H], format: 'rgba8unorm' }).$usage('render', 'sampled');
  const bloomA = root.createTexture({ size: [HW, HH], format: 'rgba8unorm' }).$usage('render', 'sampled');
  const bloomB = root.createTexture({ size: [HW, HH], format: 'rgba8unorm' }).$usage('render', 'sampled');

  const sceneTex = scene.createView(d.texture2d(d.f32));
  const bloomATex = bloomA.createView(d.texture2d(d.f32));
  const bloomBTex = bloomB.createView(d.texture2d(d.f32));
  const linear = root.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const params = root.createUniform(CrtParams);
  const paramRaw = root.unwrap(params.buffer);
  const paramData = new Float32Array(d.sizeOf(CrtParams) / 4);

  const bright = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((input) => {
    'use gpu';
    const c = std.textureSample(sceneTex.$, linear.$, input.uv).xyz;
    const peak = std.max(c.x, std.max(c.y, c.z));
    return d.vec4f(c.mul(std.smoothstep(0.2, 0.95, peak)), 1);
  });

  const blurH = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((input) => {
    'use gpu';
    const s = d.vec2f(1.6 / HW, 0);
    let acc = std.textureSample(bloomATex.$, linear.$, input.uv).xyz.mul(0.227);
    acc = acc.add(std.textureSample(bloomATex.$, linear.$, input.uv.add(s.mul(1.3846))).xyz.mul(0.3162));
    acc = acc.add(std.textureSample(bloomATex.$, linear.$, input.uv.sub(s.mul(1.3846))).xyz.mul(0.3162));
    acc = acc.add(std.textureSample(bloomATex.$, linear.$, input.uv.add(s.mul(3.2308))).xyz.mul(0.0703));
    acc = acc.add(std.textureSample(bloomATex.$, linear.$, input.uv.sub(s.mul(3.2308))).xyz.mul(0.0703));
    return d.vec4f(acc, 1);
  });
  const blurV = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((input) => {
    'use gpu';
    const s = d.vec2f(0, 1.6 / HH);
    let acc = std.textureSample(bloomBTex.$, linear.$, input.uv).xyz.mul(0.227);
    acc = acc.add(std.textureSample(bloomBTex.$, linear.$, input.uv.add(s.mul(1.3846))).xyz.mul(0.3162));
    acc = acc.add(std.textureSample(bloomBTex.$, linear.$, input.uv.sub(s.mul(1.3846))).xyz.mul(0.3162));
    acc = acc.add(std.textureSample(bloomBTex.$, linear.$, input.uv.add(s.mul(3.2308))).xyz.mul(0.0703));
    acc = acc.add(std.textureSample(bloomBTex.$, linear.$, input.uv.sub(s.mul(3.2308))).xyz.mul(0.0703));
    return d.vec4f(acc, 1);
  });

  const sharp = (uv: d.v2f, scale: number): d.v2f => {
    'use gpu';
    const texel = uv.mul(vsize);
    const seam = std.floor(texel.add(0.5));
    const offset = std.clamp(texel.sub(seam).mul(scale), d.vec2f(-0.5), d.vec2f(0.5));
    return seam.add(offset).div(vsize);
  };

  /** A scene pixel, clamped to the edge. */
  const texel = (x: number, y: number): d.v3f => {
    'use gpu';
    const tx = std.clamp(x, 0, W - 1);
    const ty = std.clamp(y, 0, H - 1);
    return std.textureLoad(sceneTex.$, d.vec2i(d.i32(tx), d.i32(ty)), 0).xyz;
  };

  /** Lottes' Warp: bends the scanlines (and the ports' picture) into a tube. */
  const warp = (uv: d.v2f): d.v2f => {
    'use gpu';
    const p = params.$;
    const c = uv.mul(2).sub(1);
    return c.mul(d.vec2f(1 + c.y * c.y * p.warpX, 1 + c.x * c.x * p.warpY)).mul(0.5).add(0.5);
  };

  /** What every composite shares: black level, vignette, flicker, grain, the game's flash and fade, and the tube's edge. */
  const finish = (color: d.v3f, uv: d.v2f, cuv: d.v2f, px: d.v2f): d.v4f => {
    'use gpu';
    const p = params.$;
    if (p.ours < 0.5) {
      // The shader alone, black outside the picture as in RetroArch's viewport; the game's flash and fade stay.
      const shown = std.select(0, 1, uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1);
      const plain = color.add(d.vec3f(0.05, 0.08, 0.06).mul(p.flash)).mul((1 - p.fade) * shown);
      return d.vec4f(std.saturate(plain), 1);
    }
    const c = uv.mul(2).sub(1);
    const r2 = std.dot(c, c);
    const edgePx = std.min(
      std.min(cuv.x, 1 - cuv.x) * p.content.x,
      std.min(cuv.y, 1 - cuv.y) * p.content.y,
    );
    const inside = std.clamp(edgePx / 1.5, 0, 1);

    let out = color.add(d.vec3f(0.006, 0.008, 0.014).mul(1 - r2 * 0.35));
    out = out.mul(1 - 0.2 * r2);
    out = out.mul(1 + 0.01 * std.sin(p.time * 53));
    out = out.add(d.vec3f((hash(px.add(d.vec2f(p.time * 61, p.time * 17))) - 0.5) * 0.035));
    out = out.add(d.vec3f(0.05, 0.08, 0.06).mul(p.flash));
    out = out.mul((1 - p.fade) * inside);
    return d.vec4f(std.max(out, d.vec3f(0)), 1);
  };

  /** Masks and scanlines alias under three physical pixels per virtual one: fade them out below that. */
  const detail = (): number => {
    'use gpu';
    return std.select(1, std.clamp(params.$.scale - 2, 0, 1), params.$.ours > 0.5);
  };

  const old = tgpu.fragmentFn({ in: { pos: d.builtin.position }, out: d.vec4f })((input) => {
    'use gpu';
    const p = params.$;
    const uv = input.pos.xy.sub(p.offset).div(p.content);

    const c = uv.mul(2).sub(1);
    const r2 = std.dot(c, c);
    const bent = c.mul(1 + 0.028 * r2).div(1.012);
    const cuv = bent.mul(0.5).add(0.5);

    const ca = bent.mul(0.55 / W);
    const r = std.textureSample(sceneTex.$, linear.$, sharp(cuv.add(ca), p.scale)).x;
    const g = std.textureSample(sceneTex.$, linear.$, sharp(cuv, p.scale)).y;
    const b = std.textureSample(sceneTex.$, linear.$, sharp(cuv.sub(ca), p.scale)).z;
    let color = d.vec3f(r, g, b);

    color = color.add(std.textureSample(bloomATex.$, linear.$, cuv).xyz.mul(0.55));

    const row = std.fract(cuv.y * H);
    const lineStrength = std.clamp((p.scale - 2) * 0.5, 0, 1) * 0.2;
    const line = 1 - lineStrength * (1 - std.sin(row * 3.14159265));
    color = color.mul(line);

    return finish(color, uv, cuv, input.pos.xy);
  });

  // crt-lottes. `base` is the scene pixel under the sample point, `dist` its Dist().

  const gaus = (pos: number, scale: number): number => {
    'use gpu';
    return std.exp2(scale * std.pow(std.abs(pos), params.$.shape));
  };
  const fetch = (base: d.v2f, x: number, y: number): d.v3f => {
    'use gpu';
    return toLinear(texel(base.x + x, base.y + y).mul(params.$.bright));
  };
  const horz3 = (base: d.v2f, dst: number, off: number): d.v3f => {
    'use gpu';
    const s = params.$.hardPix;
    const wb = gaus(dst - 1, s);
    const wc = gaus(dst, s);
    const wd = gaus(dst + 1, s);
    const sum = fetch(base, -1, off).mul(wb).add(fetch(base, 0, off).mul(wc)).add(fetch(base, 1, off).mul(wd));
    return sum.div(wb + wc + wd);
  };
  const horz5 = (base: d.v2f, dst: number, off: number): d.v3f => {
    'use gpu';
    const s = params.$.hardPix;
    const wa = gaus(dst - 2, s);
    const wb = gaus(dst - 1, s);
    const wc = gaus(dst, s);
    const wd = gaus(dst + 1, s);
    const we = gaus(dst + 2, s);
    let sum = fetch(base, -2, off).mul(wa).add(fetch(base, -1, off).mul(wb)).add(fetch(base, 0, off).mul(wc));
    sum = sum.add(fetch(base, 1, off).mul(wd)).add(fetch(base, 2, off).mul(we));
    return sum.div(wa + wb + wc + wd + we);
  };
  const horz7 = (base: d.v2f, dst: number, off: number): d.v3f => {
    'use gpu';
    const wa = gaus(dst - 3, BLOOM_PIX);
    const wb = gaus(dst - 2, BLOOM_PIX);
    const wc = gaus(dst - 1, BLOOM_PIX);
    const wd = gaus(dst, BLOOM_PIX);
    const we = gaus(dst + 1, BLOOM_PIX);
    const wf = gaus(dst + 2, BLOOM_PIX);
    const wg = gaus(dst + 3, BLOOM_PIX);
    let sum = fetch(base, -3, off).mul(wa).add(fetch(base, -2, off).mul(wb)).add(fetch(base, -1, off).mul(wc));
    sum = sum.add(fetch(base, 0, off).mul(wd)).add(fetch(base, 1, off).mul(we));
    sum = sum.add(fetch(base, 2, off).mul(wf)).add(fetch(base, 3, off).mul(wg));
    return sum.div(wa + wb + wc + wd + we + wf + wg);
  };
  /** The nearest three scanlines, each a Gaussian beam. */
  const tri = (base: d.v2f, dist: d.v2f): d.v3f => {
    'use gpu';
    const s = params.$.hardScan;
    const a = horz3(base, dist.x, -1).mul(gaus(dist.y - 1, s));
    const b = horz5(base, dist.x, 0).mul(gaus(dist.y, s));
    const c = horz3(base, dist.x, 1).mul(gaus(dist.y + 1, s));
    return a.add(b).add(c);
  };
  const lottesBloom = (base: d.v2f, dist: d.v2f): d.v3f => {
    'use gpu';
    let sum = horz5(base, dist.x, -2).mul(gaus(dist.y - 2, BLOOM_SCAN));
    sum = sum.add(horz7(base, dist.x, -1).mul(gaus(dist.y - 1, BLOOM_SCAN)));
    sum = sum.add(horz7(base, dist.x, 0).mul(gaus(dist.y, BLOOM_SCAN)));
    sum = sum.add(horz7(base, dist.x, 1).mul(gaus(dist.y + 1, BLOOM_SCAN)));
    return sum.add(horz5(base, dist.x, 2).mul(gaus(dist.y + 2, BLOOM_SCAN)));
  };
  const lottesMask = (pos: d.v2f): d.v3f => {
    'use gpu';
    const p = params.$;
    const kind = std.round(p.lottesMask);
    const dark = p.maskDark;
    const light = p.maskLight;
    let mask = d.vec3f(1);
    if (kind === 1) {
      // Very compressed TV style shadow mask.
      const odd = std.select(0, 1, std.fract(pos.x * 0.166666666) < 0.5);
      const line = std.select(light, dark, std.fract((pos.y + odd) * 0.5) < 0.5);
      mask = stripe(std.fract(pos.x * 0.333333333), dark, light).mul(line);
    } else if (kind === 2) {
      // Aperture grille.
      mask = stripe(std.fract(pos.x * 0.333333333), dark, light);
    } else if (kind === 3) {
      // Stretched VGA style shadow mask.
      mask = stripe(std.fract((pos.x + pos.y * 3) * 0.166666666), dark, light);
    } else if (kind === 4) {
      // VGA style shadow mask.
      const cell = std.floor(pos.mul(d.vec2f(1, 0.5)));
      mask = stripe(std.fract((cell.x + cell.y * 3) * 0.166666666), dark, light);
    }
    return std.mix(d.vec3f(1), mask, detail());
  };

  const lottes = tgpu.fragmentFn({ in: { pos: d.builtin.position }, out: d.vec4f })((input) => {
    'use gpu';
    const p = params.$;
    const px = input.pos.xy.sub(p.offset);
    const uv = px.div(p.content);
    const cuv = warp(uv);
    const at = cuv.mul(vsize);
    const base = std.floor(at);
    const dist = d.vec2f(0.5).sub(at.sub(base));

    let color = tri(base, dist);
    if (p.lottesBloom > 0) color = color.add(lottesBloom(base, dist).mul(p.lottesBloom));
    color = color.add(toLinear(std.textureSample(bloomATex.$, linear.$, cuv).xyz).mul(p.glow));
    color = color.mul(lottesMask(px.mul(1.000001)));

    return finish(toSrgb(color), uv, cuv, input.pos.xy);
  });

  // crt-hyllian: its base pass, and the curvature and mask of its last pass. Not ported: the color
  // LUT of its first pass (it does the input gamma here) and the glow passes (off in the original).

  /**
   * Phosphor layouts from Hyllian's mask_weights (0, 1, 2, 4, 7 and 11 there). Written in RGB; Hyllian's
   * own constants name the channels the other way round (its `red` is vec3(0, 0, 1)), so its default
   * MONITOR_SUBPIXELS lights them blue first.
   */
  const hyllianMask = (pos: d.v2f): d.v3f => {
    'use gpu';
    const p = params.$;
    const kind = std.round(p.hyllianMask);
    const x = std.floor(pos.x);
    const y = std.floor(pos.y);
    let mask = d.vec3f(1);
    if (kind === 1) {
      mask = magentaGreen(wrap(x, 2));
    } else if (kind === 2) {
      mask = rgbAt(wrap(x, 3));
    } else if (kind === 3) {
      // Red, yellow, cyan, blue: for 4K.
      const i = wrap(x, 4);
      mask = d.vec3f(std.select(0, 1, i < 1.5), std.select(0, 1, i > 0.5 && i < 2.5), std.select(0, 1, i > 1.5));
    } else if (kind === 4) {
      mask = magentaGreen(std.abs(wrap(x, 2) - wrap(y, 2)));
    } else if (kind === 5) {
      const z = wrap(x, 6);
      const w = wrap(y, 4);
      const off = (w === 1 && z >= 3) || (w === 3 && z < 3);
      mask = std.select(rgbAt(wrap(z, 3)), d.vec3f(0), off);
    }
    return std.select(mask.zyx, mask, p.subpixels > 0.5);
  };
  /** h_warp: the tube as a sphere or a cylinder of radius h_radius. */
  const hyllianWarp = (uv: d.v2f): d.v2f => {
    'use gpu';
    const p = params.$;
    const r2 = p.hRadius * p.hRadius;
    const maxSize = d.vec2f(std.sqrt((r2 - 2) / (r2 - 1)), 1);
    const c = uv.mul(2).sub(1);
    const cylinder = maxSize.mul(std.sqrt((r2 - c.x * c.x) / (r2 - 2 * c.x * c.x)));
    const sphere = d.vec2f(std.sqrt((r2 - 1) / (r2 - std.dot(c, c))));
    return c.mul(std.mix(sphere, cylinder, p.hShape)).mul(0.5).add(0.5);
  };
  /** h_corner: rounds the picture's corners off. */
  const hyllianCorner = (uv: d.v2f): number => {
    'use gpu';
    const p = params.$;
    const aspect = d.vec2f(1, p.content.y / p.content.x);
    const size = p.hCornerSize * std.min(aspect.x, aspect.y);
    const smooth = p.hCornerSmooth / 100;
    const dd = std.abs(uv.mul(2).sub(1).mul(aspect)).sub(aspect.sub(size));
    const borderline = std.length(std.max(dd, d.vec2f(0))) + std.min(std.max(dd.x, dd.y), 0) - size;
    // smoothstep(smooth, -smooth, x), with its edges in the order WGSL wants.
    return 1 - std.smoothstep(-smooth, smooth, borderline);
  };
  // Hyllian's passes, each into a texture as the original does (8-bit sRGB): the scene in light (its
  // first pass, with the LUT off), then the beams at the picture's size, which the last pass reads bilinearly
  // (RetroArch samples a pass's output with the next pass's filter, here filter_linear2 = true).
  const hLin = root.createTexture({ size: [W, H], format: 'rgba8unorm-srgb' }).$usage('render', 'sampled');
  const hLinTex = hLin.createView(d.texture2d(d.f32));
  const hBaseLayout = tgpu.bindGroupLayout({ beams: { texture: d.texture2d(d.f32) } });

  const lut1 = root.createTexture({ size: [LUT_SIZE * LUT_SIZE, LUT_SIZE], format: 'rgba8unorm' }).$usage('sampled');
  const lut2 = root.createTexture({ size: [LUT_SIZE * LUT_SIZE, LUT_SIZE], format: 'rgba8unorm' }).$usage('sampled');
  const lut1Tex = lut1.createView(d.texture2d(d.f32));
  const lut2Tex = lut2.createView(d.texture2d(d.f32));
  /** Until the LUTs are decoded, Hyllian draws as with LUT_selector_param off. */
  let lutsIn = false;
  const ready = import('./hyllian-luts.ts').then(async ({ SAMPLER_LUT1, SAMPLER_LUT2 }) => {
    for (const [png, texture] of [[SAMPLER_LUT1, lut1], [SAMPLER_LUT2, lut2]] as const) {
      const { width, height, rgba } = await decodePng(Uint8Array.from(atob(png), (ch) => ch.charCodeAt(0)));
      root.device.queue.writeTexture({ texture: root.unwrap(texture) }, rgba, { bytesPerRow: width * 4 }, [width, height]);
    }
    lutsIn = true;
  });

  /** multiLUT-linear-fast: the color LUT, then the input gamma. */
  const hyllianLin = tgpu.fragmentFn({ in: { pos: d.builtin.position }, out: d.vec4f })((input) => {
    'use gpu';
    const p = params.$;
    const img = std.textureLoad(sceneTex.$, d.vec2i(d.i32(input.pos.x), d.i32(input.pos.y)), 0).xyz;
    let color = d.vec3f(img);
    if (p.lut > 0.5) {
      const n = LUT_SIZE;
      const red = (img.x * (n - 1) + 0.4999) / (n * n);
      const green = (img.y * (n - 1) + 0.4999) / n;
      const blue1 = std.floor(img.z * (n - 1)) / n + red;
      const blue2 = std.ceil(img.z * (n - 1)) / n + red;
      const mixer = std.clamp(std.max((img.z - blue1) / (blue2 - blue1), 0), 0, 32);
      const cool = p.lut > 1.5;
      const color1 = std.select(std.textureSampleLevel(lut1Tex.$, linear.$, d.vec2f(blue1, green), 0), std.textureSampleLevel(lut2Tex.$, linear.$, d.vec2f(blue1, green), 0), cool).xyz;
      const color2 = std.select(std.textureSampleLevel(lut1Tex.$, linear.$, d.vec2f(blue2, green), 0), std.textureSampleLevel(lut2Tex.$, linear.$, d.vec2f(blue2, green), 0), cool).xyz;
      // Hyllian's mixfix: "some undefined values can creep in".
      color = std.select(color1, std.mix(color1, color2, mixer), color1.z < 1);
    }
    return d.vec4f(std.pow(color, d.vec3f(2.4)), 1);
  });
  const linTexel = (x: number, y: number): d.v3f => {
    'use gpu';
    const tx = std.clamp(x, 0, W - 1);
    const ty = std.clamp(y, 0, H - 1);
    return std.textureLoad(hLinTex.$, d.vec2i(d.i32(tx), d.i32(ty)), 0).xyz;
  };
  /** One scanline: a Catmull-Rom across four pixels, clamped to its middle two (anti-ringing). */
  const hyllianRow = (base: d.v2f, f: number, off: number): d.v3f => {
    'use gpu';
    const c0 = linTexel(base.x - 1, base.y + off);
    const c1 = linTexel(base.x, base.y + off);
    const c2 = linTexel(base.x + 1, base.y + off);
    const c3 = linTexel(base.x + 2, base.y + off);
    const f2 = f * f;
    const f3 = f2 * f;
    const w0 = -0.5 * f3 + f2 - 0.5 * f;
    const w1 = 1.5 * f3 - 2.5 * f2 + 1;
    const w2 = -1.5 * f3 + 2 * f2 + 0.5 * f;
    const w3 = 0.5 * f3 - 0.5 * f2;
    const color = c0.mul(w0).add(c1.mul(w1)).add(c2.mul(w2)).add(c3.mul(w3));
    return std.clamp(color, std.min(c1, c2), std.max(c1, c2));
  };
  /** How much of a scanline reaches `pos` rows away: a beam that widens with its brightness. */
  const beam = (color: d.v3f, pos: number): d.v3f => {
    'use gpu';
    const p = params.$;
    const lum = std.mix(d.vec3f(p.beamMin), d.vec3f(p.beamMax), color);
    const strength = p.scanlines - 0.16 * p.soft;
    const dd = d.vec3f(strength * pos).div(lum.mul(lum).add(0.0000001));
    const soft = std.exp(dd.mul(dd).mul(-16));
    const hard = d.vec3f(1).sub(std.smoothstep(d.vec3f(0), d.vec3f(0.5), dd));
    return color.mul(std.select(hard, soft, p.soft > 0.5));
  };

  /** The base pass, drawn at the picture's size. Both of Hyllian's passes stretch their coordinates by 1.0001. */
  const hyllianBeams = tgpu.fragmentFn({ in: { pos: d.builtin.position }, out: d.vec4f })((input) => {
    'use gpu';
    const at = input.pos.xy.div(params.$.content).mul(1.0001).mul(vsize).sub(0.5);
    const base = std.floor(at);
    const fp = at.sub(base);
    return d.vec4f(beam(hyllianRow(base, fp.x, 0), fp.y).add(beam(hyllianRow(base, fp.x, 1), 1 - fp.y)), 1);
  });

  const hyllian = tgpu.fragmentFn({ in: { pos: d.builtin.position }, out: d.vec4f })((input) => {
    'use gpu';
    const p = params.$;
    const px = input.pos.xy.sub(p.offset);
    const uv = px.div(p.content).mul(1.0001);
    const curved = p.hCurvature > 0.5;
    const cuv = std.select(uv, hyllianWarp(uv), curved);

    const color = std.textureSample(hBaseLayout.$.beams, linear.$, cuv).xyz;
    const glow = toLinear(std.textureSample(bloomATex.$, linear.$, cuv).xyz).mul(p.glow);
    let crt = std.pow(std.clamp(color.mul(p.bright).add(glow), d.vec3f(0), d.vec3f(1)), d.vec3f(1 / 2.2));
    const mask = hyllianMask(px.mul(1.0001));
    const curve = mask.mul(p.maskStrength * detail() * (HYLLIAN_MASK_GAMMA - 1)).add(1);
    crt = mask.add(d.vec3f(1).sub(mask.mul(2)).mul(std.pow(std.abs(mask.sub(crt)), curve)));
    crt = crt.mul(std.select(1, hyllianCorner(cuv), curved));

    return finish(crt, uv, cuv, input.pos.xy);
  });

  const target = { format: 'rgba8unorm' as const };
  const brightPipe = root.createRenderPipeline({ vertex: common.fullScreenTriangle, fragment: bright, targets: target });
  const blurHPipe = root.createRenderPipeline({ vertex: common.fullScreenTriangle, fragment: blurH, targets: target });
  const blurVPipe = root.createRenderPipeline({ vertex: common.fullScreenTriangle, fragment: blurV, targets: target });
  const crtPipes = [old, lottes, hyllian].map((fragment) =>
    root.createRenderPipeline({ vertex: common.fullScreenTriangle, fragment, targets: { format: opts.surfaceFormat } }),
  );
  const hLinPipe = root.createRenderPipeline({ vertex: common.fullScreenTriangle, fragment: hyllianLin, targets: { format: 'rgba8unorm-srgb' } });
  const hBeamsPipe = root.createRenderPipeline({ vertex: common.fullScreenTriangle, fragment: hyllianBeams, targets: { format: 'rgba8unorm-srgb' } });
  const hLinTarget = root.unwrap(hLin).createView();
  /** The beams texture, remade when the picture changes size. */
  let beams: { readonly w: number; readonly h: number; readonly texture: GPUTexture; readonly group: ReturnType<typeof root.createBindGroup> } | null = null;
  const beamsAt = (w: number, h: number) => {
    if (beams?.w === w && beams.h === h) return beams;
    beams?.texture.destroy();
    const texture = root.device.createTexture({ size: [w, h], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    return (beams = { w, h, texture, group: root.createBindGroup(hBaseLayout, { beams: texture.createView() }) });
  };

  const sceneTarget = root.unwrap(scene).createView();
  const bloomATarget = root.unwrap(bloomA).createView();
  const bloomBTarget = root.unwrap(bloomB).createView();

  const clear = (view: GPUTextureView) =>
    ({ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }) as const;

  return {
    /** Render the scene into this view (virtual resolution, rgba8unorm). */
    controls: controls.values,
    ready,
    sceneTarget,
    sceneFormat: 'rgba8unorm' as const,
    /** The scene texture itself, to copy from mid-frame (reflections read what's drawn so far). */
    sceneTexture: root.unwrap(scene),

    encode(
      encoder: GPUCommandEncoder,
      out: GPUTextureView,
      surface: { readonly width: number; readonly height: number },
      frame: { readonly time: number; readonly flash: number; readonly fade: number },
    ): void {
      const scale = Math.min(surface.width / W, surface.height / H);
      const cw = Math.round(W * scale);
      const ch = Math.round(H * scale);
      // In CrtParams' order.
      let i = 0;
      paramData[i++] = Math.floor((surface.width - cw) / 2);
      paramData[i++] = Math.floor((surface.height - ch) / 2);
      paramData[i++] = cw;
      paramData[i++] = ch;
      paramData[i++] = scale;
      paramData[i++] = frame.time;
      paramData[i++] = frame.flash;
      paramData[i++] = frame.fade;
      for (const t of TWEAKED) paramData[i++] = t === LUT && !lutsIn ? 0 : t.value;
      root.device.queue.writeBuffer(paramRaw, 0, paramData);

      brightPipe.withColorAttachment(clear(bloomATarget)).with(encoder).draw(3);
      blurHPipe.withColorAttachment(clear(bloomBTarget)).with(encoder).draw(3);
      blurVPipe.withColorAttachment(clear(bloomATarget)).with(encoder).draw(3);
      const shader = Math.round(CRT_SHADER.value);
      const crtPipe = crtPipes[shader] ?? crtPipes[0]!;
      if (shader === 2) {
        const b = beamsAt(cw, ch);
        hLinPipe.withColorAttachment(clear(hLinTarget)).with(encoder).draw(3);
        hBeamsPipe.withColorAttachment(clear(b.texture.createView())).with(encoder).draw(3);
        crtPipe.with(b.group).withColorAttachment(clear(out)).with(encoder).draw(3);
      } else crtPipe.withColorAttachment(clear(out)).with(encoder).draw(3);
    },

    dispose(): void {
      scene.destroy();
      bloomA.destroy();
      bloomB.destroy();
      hLin.destroy();
      lut1.destroy();
      lut2.destroy();
      beams?.texture.destroy();
    },
  };
};

export type PostFx = ReturnType<typeof createPostFx>;
