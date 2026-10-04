import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from './compare.ts';

test('counts changed RGB pixels and reports byte errors without an implicit tolerance', () => {
  const result = compare(new Uint8Array([10, 20, 30, 255, 0, 0, 0, 255]), new Uint8Array([11, 18, 30, 255, 0, 0, 0, 255]));
  assert.deepEqual(result.metrics, { exact: false, differingPixels: 1, pixels: 2, maxError: 2, meanError: 0.5 });
  assert.deepEqual([...result.difference], [1, 2, 0, 255, 0, 0, 0, 255]);
});
test('identical RGB is exact; invalid images cannot pass', () => {
  assert.equal(compare(new Uint8Array([1, 2, 3, 0]), new Uint8Array([1, 2, 3, 255])).metrics.exact, true);
  assert.throws(() => compare(new Uint8Array(), new Uint8Array()));
  assert.throws(() => compare(new Uint8Array(4), new Uint8Array(8)));
});
