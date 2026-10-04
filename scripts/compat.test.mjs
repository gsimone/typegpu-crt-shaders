import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenTables } from './compat.mjs';

test('flattens constant mask tables without reordering channels or rows', () => {
  assert.equal(flattenTables('const vec3 mask[2][3] = {{red, green, blue,}, {black, red, green}}; result = mask[w][z];'),
    'const vec3 mask[6] = vec3[](red, green, blue, black, red, green); result = mask[(w) * 3 + (z)];');
  assert.throws(() => flattenTables('const vec3 mask[2][3] = {{red, green}, {black, red}};'));
});
