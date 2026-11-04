import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');

/** JSON.parse silently drops duplicate translations. Check the source before parsing. */
export function readCatalog(source, name) {
  const failures = [];
  const file = ts.parseJsonText(name, source);
  function visit(node, prefix = '') {
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = property.name.text;
        const location = prefix ? `${prefix}.${key}` : key;
        if (keys.has(key)) failures.push(`Duplicate key in ${name}: ${location}`);
        keys.add(key);
        visit(property.initializer, location);
      }
    }
  }
  ts.forEachChild(file, function descend(node) {
    if (ts.isObjectLiteralExpression(node)) visit(node);
    else ts.forEachChild(node, descend);
  });
  const catalog = JSON.parse(source);
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    return { catalog: {}, failures: [...failures, `Invalid catalog: ${name}`] };
  }
  for (const [group, entries] of Object.entries(catalog)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      failures.push(`Invalid message group in ${name}: ${group}`);
      continue;
    }
    for (const [key, value] of Object.entries(entries)) {
      if (typeof value !== 'string' || !value.trim()) failures.push(`Invalid message in ${name}: ${group}.${key}`);
    }
  }
  return { catalog, failures };
}

/** Translations may repeat values differently; named rich-text links must remain intact. */
export function messageSignature(value) {
  return JSON.stringify({
    parameters: [...new Set((value.match(/{{\s*[^{}]+?\s*}}/g) ?? []).map(p => p.replace(/\s/g, '')))].sort(),
    tags: (value.match(/<\/?[A-Za-z][\w-]*\s*\/?\s*>/g) ?? []).map(t => t.replace(/\s/g, '')).sort(),
  });
}
