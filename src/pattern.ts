import type { Pixels } from './reference.ts';

export function pattern(width = 320, height = 240): Pixels {
  const rgba = new Uint8Array(width * height * 4);
  const bars = [[255,255,255], [255,255,0], [0,255,255], [0,255,0], [255,0,255], [255,0,0], [0,0,255], [0,0,0]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let rgb: number[];
    if (y < height / 3) rgb = bars[Math.min(7, Math.floor(x * 8 / width))];
    else if (y < height * 2 / 3) rgb = [x * 255 / (width - 1), x * 255 / (width - 1), x * 255 / (width - 1)];
    else { const c = (x + y) % 2 === 0 ? 220 : 12; rgb = [c, c, c]; }
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) rgb = [255, 255, 255];
    if (x > 7 && x < 23 && y > 7 && y < 23) rgb = [255, 0, 0];
    rgba.set([...rgb.map(Math.round), 255], (y * width + x) * 4);
  }
  return { width, height, rgba };
}
