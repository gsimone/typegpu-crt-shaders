import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { flattenTables } from './compat.mjs';

const revision = '0b3ff0b240f82f4cb5e5d0117f8f2080e2764cf7';
const repository = 'https://github.com/libretro/slang-shaders';
const presets = { lottes: 'crt/crt-lottes.slangp', hyllian: 'crt/crt-hyllian.slangp' };
const root = resolve('public/upstream');
const digest = (data) => createHash('sha256').update(data).digest('hex');
const save = async (path, data) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, data); };

export function parsePreset(text) {
  return Object.fromEntries([...text.matchAll(/^\s*(\w+)\s*=\s*"?([^"\r\n]+)"?\s*$/gm)].map((m) => [m[1], m[2].trim()]));
}

async function fetchSources() {
  const files = {};
  async function pull(path) {
    path = posix.normalize(path);
    if (files[path]) return;
    const response = await fetch(`https://raw.githubusercontent.com/libretro/slang-shaders/${revision}/${path}`);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    files[path] = digest(data);
    await save(resolve(root, path), data);
    if (path.endsWith('.slangp')) {
      const preset = parsePreset(data.toString());
      const paths = Object.entries(preset).filter(([key]) => /^shader\d+$/.test(key)).map(([, value]) => value);
      for (const name of (preset.textures ?? '').split(';').filter(Boolean)) paths.push(preset[name]);
      for (const child of paths) await pull(posix.join(posix.dirname(path), child));
    } else if (/\.(slang|h)$/.test(path)) {
      for (const match of data.toString().matchAll(/^\s*#include\s+"([^"]+)"/gm)) await pull(posix.join(posix.dirname(path), match[1]));
    }
  }
  for (const path of Object.values(presets)) await pull(path);
  await writeFile('upstream.lock.json', JSON.stringify({ repository, revision, presets, files }, null, 2) + '\n');
  console.log(`Pinned ${Object.keys(files).length} upstream files at ${revision}`);
}

async function verify() {
  const lock = JSON.parse(await readFile('upstream.lock.json', 'utf8'));
  for (const [path, expected] of Object.entries(lock.files)) {
    if (digest(await readFile(resolve(root, path))) !== expected) throw new Error(`Upstream checksum mismatch: ${path}`);
  }
  console.log(`Verified ${Object.keys(lock.files).length} upstream checksums`);
}

async function verifyGenerated() {
  const lock = JSON.parse(await readFile('compiled.lock.json', 'utf8'));
  for (const [path, expected] of Object.entries(lock.files)) {
    if (digest(await readFile(path)) !== expected) throw new Error(`Compiled source is stale or modified: ${path}. Run npm run upstream:compile.`);
  }
  const legacy = JSON.parse(await readFile('legacy/provenance.json', 'utf8'));
  for (const [path, expected] of Object.entries(legacy.sha256)) {
    if (digest(await readFile(`legacy/original/${path}`)) !== expected) throw new Error(`Extracted original was modified: ${path}`);
  }
  console.log('Verified compiled sources and byte-for-byte port originals');
}

async function expand(path) {
  const text = await readFile(resolve(root, path), 'utf8');
  const parts = [];
  let end = 0;
  for (const match of text.matchAll(/^\s*#include\s+"([^"]+)"/gm)) {
    parts.push(text.slice(end, match.index), await expand(posix.join(posix.dirname(path), match[1])));
    end = match.index + match[0].length;
  }
  return parts.join('') + text.slice(end);
}

async function compile() {
  await verify();
  const manifest = {};
  for (const [name, path] of Object.entries(presets)) {
    const preset = parsePreset(await readFile(resolve(root, path), 'utf8'));
    const passes = [];
    const parameters = {};
    for (let i = 0; i < Number(preset.shaders); i++) {
      const source = posix.join(posix.dirname(path), preset[`shader${i}`]);
      const text = await expand(source);
      for (const m of text.matchAll(/#pragma parameter (\w+)\s+"([^"]*)"\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/gi)) {
        parameters[m[1]] = { label: m[2].trim(), initial: Number(preset[m[1]] ?? m[3]), min: Number(m[4]), max: Number(m[5]), step: Number(m[6]) };
      }
      const common = text.split('#pragma stage vertex')[0];
      const vertex = text.split('#pragma stage vertex')[1].split('#pragma stage fragment')[0];
      const fragment = text.split('#pragma stage fragment')[1];
      const stages = {};
      for (const [stage, body] of Object.entries({ vert: vertex, frag: fragment })) {
        const input = resolve(`.cache/${name}-${i}.${stage}`);
        const spv = `${input}.spv`;
        await save(input, flattenTables(common + body).replace(/^\s*#pragma.*$/gm, ''));
        execFileSync('glslangValidator', ['-V', input, '-o', spv], { stdio: 'pipe' });
        stages[stage] = execFileSync('spirv-cross', [spv, '--es', '--version', '300', '--glsl-emit-ubo-as-plain-uniforms', '--flatten-multidimensional-arrays'], { encoding: 'utf8' });
      }
      passes.push({ source, ...stages });
    }
    manifest[name] = { preset, parameters, passes, directory: posix.dirname(path) };
  }
  await save('public/compiled/shaders.json', JSON.stringify(manifest));
  const files = {};
  for (const path of ['upstream.lock.json', 'scripts/upstream.mjs', 'scripts/compat.mjs', 'public/compiled/shaders.json']) files[path] = digest(await readFile(path));
  await writeFile('compiled.lock.json', JSON.stringify({
    glslang: execFileSync('glslangValidator', ['--version'], { encoding: 'utf8' }).trim(),
    files,
  }, null, 2) + '\n');
  console.log('Compiled original vertex and fragment stages for both presets');
}

const command = process.argv[2];
if (command === 'fetch') await fetchSources();
else if (command === 'compile') await compile();
else if (command === 'verify') { await verify(); await verifyGenerated(); }
else throw new Error('Expected fetch, compile or verify');
