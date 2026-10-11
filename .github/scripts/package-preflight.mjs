import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Also usable locally from any working directory, before npm install/ci.
const directory = process.argv[2] ?? fileURLToPath(new URL('../../frontend/', import.meta.url));
const errors = [];

for (const filename of ['package.json', 'package-lock.json']) {
  const path = resolve(directory, filename);
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    errors.push(path + ': ' + (error instanceof SyntaxError ? 'Invalid JSON: ' : '') + error.message);
    continue;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    errors.push(path + ': expected a JSON object.');
    continue;
  }
  if (filename === 'package.json') {
    for (const name of ['lint', 'test', 'typecheck', 'build']) {
      const command = data.scripts?.[name];
      if (typeof command !== 'string' || !command.trim()) {
        errors.push(path + ': scripts.' + name + ' must be a non-empty command. Preserve required CI scripts when resolving merges.');
      }
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Package preflight passed. npm ci will validate dependency/lockfile consistency.');
}
