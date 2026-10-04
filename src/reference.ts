import { decodePng } from '../legacy/png.ts';

export type ShaderName = 'lottes' | 'hyllian';
export type Pixels = { width: number; height: number; rgba: Uint8Array<ArrayBuffer> };
export type Parameter = { label: string; initial: number; min: number; max: number; step: number };
export type Preset = {
  preset: Record<string, string>;
  directory: string;
  parameters: Record<string, Parameter>;
  passes: { source: string; vert: string; frag: string }[];
};
type Texture = { texture: WebGLTexture; width: number; height: number };

const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const size = (t: { width: number; height: number }) => [t.width, t.height, 1 / t.width, 1 / t.height];

// WebGL lacks clamp-to-border. These lookups reproduce transparent black border taps.
const borderSampling = `
uniform bool referenceLinear;
uniform bool referenceMipmap;
vec4 borderTexel(sampler2D tex, ivec2 p, int level) {
  ivec2 s = textureSize(tex, level);
  if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, s))) return vec4(0.0);
  return texelFetch(tex, p, level);
}
vec4 borderLevel(sampler2D tex, vec2 uv, int level, bool linearFilter) {
  vec2 at = uv * vec2(textureSize(tex, level));
  if (!linearFilter) return borderTexel(tex, ivec2(floor(at)), level);
  vec2 f = fract(at - 0.5);
  ivec2 p = ivec2(floor(at - 0.5));
  return mix(mix(borderTexel(tex, p, level), borderTexel(tex, p + ivec2(1, 0), level), f.x),
             mix(borderTexel(tex, p + ivec2(0, 1), level), borderTexel(tex, p + ivec2(1, 1), level), f.x), f.y);
}
vec4 borderTexture(sampler2D tex, vec2 uv) {
  if (!referenceMipmap) return borderLevel(tex, uv, 0, referenceLinear);
  vec2 s = vec2(textureSize(tex, 0));
  float lod = clamp(log2(max(length(dFdx(uv) * s), length(dFdy(uv) * s))), 0.0, floor(log2(max(s.x, s.y))));
  int lo = int(floor(lod));
  int hi = int(ceil(lod));
  return mix(borderLevel(tex, uv, lo, true), borderLevel(tex, uv, hi, true), fract(lod));
}
vec4 borderLut(sampler2D tex, vec2 uv) {
  return borderLevel(tex, uv, 0, true);
}
`;

export async function createReference(preset: Preset) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false });
  if (!gl) throw new Error('WebGL 2 is required for the upstream reference');
  gl.disable(gl.DITHER);
  gl.disable(gl.BLEND);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  const programs: WebGLProgram[] = [];
  const buffers: WebGLBuffer[] = [];
  const textures: WebGLTexture[] = [];
  const frames: WebGLFramebuffer[] = [];

  function compile(type: number, source: string) {
    const shader = gl!.createShader(type)!;
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(shader) ?? 'Shader compilation failed');
    return shader;
  }
  for (const [i, pass] of preset.passes.entries()) {
    let fragment = pass.frag.replace('precision mediump float;', 'precision highp float;');
    const border = (preset.preset[`wrap_mode${i}`] ?? 'clamp_to_border') === 'clamp_to_border';
    if (border) {
      fragment = fragment.replace(/\btexture\((Source|CRTPass|src),/g, 'borderTexture($1,');
      fragment = fragment.replace(/\btexture\((SamplerLUT[12]),/g, 'borderLut($1,');
      const at = fragment.indexOf('struct ');
      fragment = fragment.slice(0, at) + borderSampling + fragment.slice(at);
    }
    const program = gl.createProgram()!;
    const vertex = compile(gl.VERTEX_SHADER, pass.vert);
    const frag = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vertex);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(frag);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Program link failed');
    programs.push(program);
  }
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  for (const [location, data, components] of [
    [0, [-1, -1, 3, -1, -1, 3], 2],
    [1, [0, 0, 2, 0, 0, 2], 2],
  ] as const) {
    const buffer = gl.createBuffer()!;
    buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, components, gl.FLOAT, false, 0, 0);
  }

  function texture(width: number, height: number, srgb: boolean, rgba: Uint8Array<ArrayBuffer> | null = null): Texture {
    const t = gl!.createTexture()!;
    textures.push(t);
    gl!.bindTexture(gl!.TEXTURE_2D, t);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, srgb ? gl!.SRGB8_ALPHA8 : gl!.RGBA8, width, height, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, rgba);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST);
    return { texture: t, width, height };
  }
  const luts: Record<string, Texture> = {};
  for (const name of (preset.preset.textures ?? '').split(';').filter(Boolean)) {
    const response = await fetch(`/upstream/${preset.directory}/${preset.preset[name]}`);
    if (!response.ok) throw new Error(`Missing LUT: ${name}`);
    const image = await decodePng(new Uint8Array(await response.arrayBuffer()));
    luts[name] = texture(image.width, image.height, false, image.rgba);
  }
  const persistentTextures = textures.length;

  function render(image: Pixels, output: { width: number; height: number }, values: Record<string, number> = {}): Pixels {
    for (const t of textures.splice(persistentTextures)) gl!.deleteTexture(t);
    for (const f of frames.splice(0)) gl!.deleteFramebuffer(f);
    const original = texture(image.width, image.height, false, image.rgba);
    let source = original;
    const aliases: Record<string, Texture> = {};
    const settings = { ...Object.fromEntries(Object.entries(preset.parameters).map(([k, p]) => [k, p.initial])), ...values };
    for (const [i, program] of programs.entries()) {
      const config = preset.preset;
      const last = i === programs.length - 1;
      const dimension = (axis: 'x' | 'y') => {
        const key = axis === 'x' ? 'width' : 'height';
        const kind = config[`scale_type_${axis}${i}`] ?? config[`scale_type${i}`] ?? (last ? 'viewport' : 'source');
        const scale = Number(config[`scale_${axis}${i}`] ?? config[`scale${i}`] ?? 1);
        return Math.max(1, Math.floor((kind === 'absolute' ? 1 : kind === 'viewport' ? output[key] : source[key]) * scale));
      };
      const target = texture(dimension('x'), dimension('y'), !last && config[`srgb_framebuffer${i}`] === 'true');
      const framebuffer = gl!.createFramebuffer()!;
      frames.push(framebuffer);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer);
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, target.texture, 0);
      if (gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) !== gl!.FRAMEBUFFER_COMPLETE) throw new Error(`Incomplete framebuffer at pass ${i}`);
      gl!.viewport(0, 0, target.width, target.height);
      gl!.useProgram(program);
      let unit = 0;
      for (let u = 0; u < gl!.getProgramParameter(program, gl!.ACTIVE_UNIFORMS); u++) {
        const info = gl!.getActiveUniform(program, u)!;
        const location = gl!.getUniformLocation(program, info.name);
        const name = info.name.split('.').at(-1)!;
        if (info.type === gl!.SAMPLER_2D) {
          const input = { Source: source, Original: original, ...aliases, ...luts }[name];
          if (!input) throw new Error(`Unsupported sampler: ${name}`);
          const linear = name in luts ? config[`${name}_linear`] !== 'false' : config[`filter_linear${i}`] === 'true';
          const mipmap = name === 'Source' && config[`mipmap_input${i}`] === 'true';
          gl!.activeTexture(gl!.TEXTURE0 + unit);
          gl!.bindTexture(gl!.TEXTURE_2D, input.texture);
          if (mipmap) gl!.generateMipmap(gl!.TEXTURE_2D);
          gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, mipmap ? gl!.LINEAR_MIPMAP_LINEAR : linear ? gl!.LINEAR : gl!.NEAREST);
          gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, linear ? gl!.LINEAR : gl!.NEAREST);
          gl!.uniform1i(location, unit++);
        } else if (name === 'MVP') gl!.uniformMatrix4fv(location, false, identity);
        else if (name === 'SourceSize') gl!.uniform4fv(location, size(source));
        else if (name === 'OriginalSize') gl!.uniform4fv(location, size(original));
        else if (name === 'OutputSize') gl!.uniform4fv(location, size(target));
        else if (name === 'FrameCount') gl!.uniform1ui(location, 0);
        else if (name === 'referenceLinear') gl!.uniform1i(location, config[`filter_linear${i}`] === 'true' ? 1 : 0);
        else if (name === 'referenceMipmap') gl!.uniform1i(location, config[`mipmap_input${i}`] === 'true' ? 1 : 0);
        else if (name in settings) gl!.uniform1f(location, settings[name]);
        else throw new Error(`Unsupported uniform: ${info.name}`);
      }
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      const error = gl!.getError();
      if (error !== gl!.NO_ERROR) throw new Error(`WebGL error ${error} at pass ${i}`);
      if (config[`alias${i}`]) aliases[config[`alias${i}`]] = target;
      source = target;
    }
    const rgba = new Uint8Array(source.width * source.height * 4);
    gl!.readPixels(0, 0, source.width, source.height, gl!.RGBA, gl!.UNSIGNED_BYTE, rgba);
    return { width: source.width, height: source.height, rgba };
  }
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    render,
    renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) as string,
    dispose() {
      textures.forEach((t) => gl.deleteTexture(t));
      programs.forEach((p) => gl.deleteProgram(p));
      buffers.forEach((b) => gl.deleteBuffer(b));
      frames.forEach((f) => gl.deleteFramebuffer(f));
      gl.deleteVertexArray(vao);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
