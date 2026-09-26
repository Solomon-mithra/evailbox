import { readdir, readFile } from 'node:fs/promises';

// Compare names only. Never print values, fingerprints, or secret-bearing lines.
const files = (await readdir('.')).filter((name) => /^\.env(?:\..+)?$/.test(name)).sort();
const canonical = files.includes('.env.local') ? '.env.local' : '.env.example';
const names = new Map();
let failed = false;
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const keys = [...text.matchAll(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]);
  const duplicates = keys.filter((key, i) => keys.indexOf(key) !== i);
  if (duplicates.length) {
    console.error(`${file}: duplicate names: ${[...new Set(duplicates)].join(', ')}`);
    failed = true;
  }
  names.set(file, new Set(keys));
}
if (!names.has(canonical)) throw new Error('Missing canonical environment template');
const expected = names.get(canonical);
for (const [file, keys] of names) {
  const missing = [...expected].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !expected.has(key));
  if (missing.length || extra.length) {
    console.error(`${file}: missing [${missing.join(', ')}]; extra [${extra.join(', ')}]`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
else
  console.log(
    `${files.length} environment files match ${canonical}: ${expected.size} variable names. Values were not compared.`,
  );
