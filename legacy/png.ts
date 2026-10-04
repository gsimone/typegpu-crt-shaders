/**
 * Decode an 8-bit, non-interlaced RGB or RGBA PNG to RGBA bytes, in the browser or in Node (both have
 * DecompressionStream). Enough for the images the engine embeds; anything else throws.
 */
export const decodePng = async (png: Uint8Array): Promise<{ readonly width: number; readonly height: number; readonly rgba: Uint8Array<ArrayBuffer> }> => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const [depth, color, , , interlace] = png.subarray(24, 29);
  const channels = color === 2 ? 3 : color === 6 ? 4 : 0;
  if (depth !== 8 || channels === 0 || interlace !== 0) throw new Error(`png: only 8-bit RGB/RGBA, not interlaced (depth ${depth}, color ${color}, interlace ${interlace})`);

  const idat: Uint8Array[] = [];
  for (let at = 8; at < png.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const zlib = new Blob(idat as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(zlib).arrayBuffer());

  // Undo each row's filter (none, sub, up, average, Paeth), then widen to RGBA.
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[out + x - channels]! : 0;
      const b = y > 0 ? pixels[out - stride + x]! : 0;
      const c = x >= channels && y > 0 ? pixels[out - stride + x - channels]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predict = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      pixels[out + x] = (row[x]! + predict) & 255;
    }
  }
  if (channels === 4) return { width, height, rgba: pixels };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([pixels[i * 3]!, pixels[i * 3 + 1]!, pixels[i * 3 + 2]!, 255], i * 4);
  return { width, height, rgba };
};
