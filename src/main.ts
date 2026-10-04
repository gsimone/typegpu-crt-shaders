import './style.css';
import { createReference, type Pixels, type Preset, type ShaderName } from './reference.ts';
import { createPort } from './port.ts';
import { compare } from './compare.ts';
import { pattern } from './pattern.ts';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = element('status');
const shader = element<HTMLSelectElement>('shader');
const scale = element<HTMLSelectElement>('scale');
let input = pattern();
let report: unknown = null;
let busy = false;
let inputName = 'diagnostic-pattern';
const response = await fetch('/compiled/shaders.json');
if (!response.ok) throw new Error('Cannot load compiled upstream shaders');
const presets: Record<ShaderName, Preset> = await response.json();
const references = new Map<ShaderName, Awaited<ReturnType<typeof createReference>>>();
let port: Awaited<ReturnType<typeof createPort>> | undefined;

function paint(id: string, image: Pixels) {
  const canvas = element<HTMLCanvasElement>(id);
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
}
function parameters() {
  const container = element('parameters');
  container.replaceChildren();
  for (const [name, p] of Object.entries(presets[shader.value as ShaderName].parameters)) {
    if (p.min === p.max) continue;
    const label = document.createElement('label');
    label.textContent = p.label || name;
    const control = document.createElement('input');
    control.type = 'number'; control.dataset.parameter = name;
    control.min = String(p.min); control.max = String(p.max); control.step = String(p.step); control.value = String(p.initial);
    label.append(control); container.append(label);
  }
}
async function render(defaults = true) {
  if (busy) return;
  busy = true;
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select').forEach((b) => b.disabled = true);
  for (const id of ['reference', 'port', 'difference']) { const c = element<HTMLCanvasElement>(id); c.width = 0; c.height = 0; }
  try {
    const name = shader.value as ShaderName;
    status.textContent = `Rendering ${name}…`;
    report = null;
    if (defaults) parameters();
    document.querySelectorAll<HTMLInputElement>('[data-parameter]').forEach((c) => c.disabled = true);
    const values = Object.fromEntries([...document.querySelectorAll<HTMLInputElement>('[data-parameter]')].map((c) => [c.dataset.parameter!, Number(c.value)]));
    for (const [key, value] of Object.entries(values)) {
      const p = presets[name].parameters[key];
      if (!Number.isFinite(value) || value < p.min || value > p.max) throw new Error(`${key} must be between ${p.min} and ${p.max}`);
    }
    const output = { width: Math.round(input.width * Number(scale.value)), height: Math.round(input.height * Number(scale.value)) };
    if (output.width > 4096 || output.height > 4096) throw new Error('Choose an image and scale with an output at most 4096 × 4096 pixels.');
    let reference = references.get(name);
    if (!reference) { reference = await createReference(presets[name]); references.set(name, reference); }
    const original = reference.render(input, output, values);
    paint('reference', original);
    if (!defaults) {
      for (const id of ['port', 'difference']) { const c = element<HTMLCanvasElement>(id); c.width = 0; c.height = 0; }
      element('metrics').textContent = 'Custom upstream parameters. Comparison is available at defaults.';
      status.textContent = `${presets[name].passes.length} upstream passes rendered at ${output.width} × ${output.height}.`;
      return;
    }
    port ??= await createPort();
    const rendered = await port.render(name, input, output);
    paint('port', rendered);
    const result = compare(original.rgba, rendered.rgba);
    paint('difference', { ...output, rgba: result.difference });
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', input.rgba))].map((b) => b.toString(16).padStart(2, '0')).join('');
    report = { shader: name, source: { name: inputName, width: input.width, height: input.height, rgbaSha256: hash }, output, parameters: values, metrics: result.metrics, upstreamRevision: '0b3ff0b240f82f4cb5e5d0117f8f2080e2764cf7', portRevision: 'adaf9fd', browser: navigator.userAgent, webglRenderer: reference.renderer, webgpu: port.renderer, referenceCertified: false };
    const m = result.metrics;
    element('metrics').textContent = `${m.exact ? 'EXACT' : 'DIFFERS'} · ${m.differingPixels.toLocaleString()} / ${m.pixels.toLocaleString()} pixels · max ${m.maxError}/255 · mean ${m.meanError.toFixed(4)}/255`;
    status.textContent = `${presets[name].passes.length} upstream passes · ${input.width} × ${input.height} → ${output.width} × ${output.height} · ${inputName}`;
    return report;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    element('metrics').textContent = 'Rendering failed. No comparison result.';
    console.error(error);
  } finally {
    port?.dispose(); port = undefined;
    busy = false;
    document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select').forEach((b) => b.disabled = false);
    element<HTMLButtonElement>('report').disabled = report === null;
  }
}
function download(url: string, filename: string) {
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
}
element('controls').addEventListener('submit', (e) => { e.preventDefault(); void render(); });
shader.addEventListener('change', () => { parameters(); void render(); });
scale.addEventListener('change', () => void render());
element('reference-only').addEventListener('click', () => void render(false));
element('pattern').addEventListener('click', () => { input = pattern(); inputName = 'diagnostic-pattern'; void render(); });
element<HTMLInputElement>('file').addEventListener('change', async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const image = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    if (image.width > 2048 || image.height > 2048) { image.close(); throw new Error('Use a source image at most 2048 × 2048 pixels.'); }
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0); image.close();
    input = { width: canvas.width, height: canvas.height, rgba: new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data) };
    inputName = file.name; await render();
  } catch (error) { status.textContent = String(error); }
});
document.querySelectorAll<HTMLButtonElement>('[data-save]').forEach((button) => button.addEventListener('click', () => {
  const canvas = element<HTMLCanvasElement>(button.dataset.save!);
  if (canvas.width) download(canvas.toDataURL('image/png'), `${shader.value}-${button.dataset.save}.png`);
}));
element('report').addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  download(url, `${shader.value}-comparison.json`); URL.revokeObjectURL(url);
});
Object.assign(window, { crtLab: { render, get report() { return report; }, async compare(name: ShaderName, factor = 3) { shader.value = name; scale.value = String(factor); return render(); } } });
parameters();
await render();
