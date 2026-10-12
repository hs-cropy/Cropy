import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function failures(needs) {
  if (needs?.changes?.result !== 'success') return ['Change detection did not succeed.'];
  const errors = [];
  for (const name of ['frontend', 'backend']) {
    const changed = needs.changes.outputs?.[name];
    const result = needs[name]?.result;
    if (!['true', 'false'].includes(changed)) errors.push(name + ': invalid change detection output');
    if (result !== 'success' && !(changed === 'false' && result === 'skipped')) {
      errors.push(name + ': ' + (result ?? 'missing result'));
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const needs = JSON.parse(process.env.NEEDS_JSON);
  const errors = failures(needs);
  const summary = [
    '## CI results',
    ...['changes', 'frontend', 'backend'].map(name =>
      '- ' + name + ': ' + (needs[name]?.result ?? 'missing') +
      (needs[name]?.result === 'skipped' ? ' (no relevant changes)' : '')),
    ...errors.map(error => '- ERROR: ' + error),
    '',
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (errors.length) process.exitCode = 1;
}
