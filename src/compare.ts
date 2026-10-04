export function compare(reference: Uint8Array, port: Uint8Array) {
  if (reference.length !== port.length || reference.length === 0 || reference.length % 4 !== 0) throw new Error('Expected equally sized, nonempty RGBA images');
  const difference = new Uint8Array(reference.length);
  let differingPixels = 0;
  let total = 0;
  let maxError = 0;
  for (let i = 0; i < reference.length; i += 4) {
    let changed = false;
    for (let channel = 0; channel < 3; channel++) {
      const error = Math.abs(reference[i + channel] - port[i + channel]);
      difference[i + channel] = error;
      total += error;
      maxError = Math.max(maxError, error);
      changed ||= error !== 0;
    }
    difference[i + 3] = 255;
    if (changed) differingPixels++;
  }
  const pixels = reference.length / 4;
  return { difference, metrics: { exact: differingPixels === 0, differingPixels, pixels, maxError, meanError: total / (pixels * 3) } };
}
