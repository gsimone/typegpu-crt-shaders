// ESSL 300 has no arrays of arrays. Flatten only constant vec3 tables, preserving order.
export function flattenTables(source) {
  const widths = new Map();
  source = source.replace(/const vec3 (\w+)\[(\d+)\]\[(\d+)\]\s*=\s*\{([\s\S]*?)\};/g,
    (_, name, rows, columns, body) => {
      if (widths.has(name) && widths.get(name) !== columns) throw new Error(`Conflicting table widths: ${name}`);
      widths.set(name, columns);
      const entries = body.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
      if (entries.length !== Number(rows) * Number(columns) || entries.some((s) => !/^\w+$/.test(s))) throw new Error(`Unsupported table: ${name}`);
      return `const vec3 ${name}[${entries.length}] = vec3[](${entries.join(', ')});`;
    });
  for (const [name, columns] of widths) {
    source = source.replace(new RegExp(`\\b${name}\\[(\\w+)\\]\\[(\\w+)\\]`, 'g'), `${name}[($1) * ${columns} + ($2)]`);
  }
  return source;
}
