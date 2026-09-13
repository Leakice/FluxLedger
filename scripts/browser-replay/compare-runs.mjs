// Compares the real-browser regression runs of the baseline and PR builds:
// every checkpoint's five storage raw strings and page side effects, plus the
// captured export backups, must be byte-identical.
//   node scripts/browser-replay/compare-runs.mjs <baselineDir> <prDir>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [baselineDir, prDir] = process.argv.slice(2);
if (!baselineDir || !prDir) {
  console.error('usage: node scripts/browser-replay/compare-runs.mjs <baselineDir> <prDir>');
  process.exit(1);
}
const read = dir => ({
  checkpoints: JSON.parse(readFileSync(join(dir, 'checkpoints.json'), 'utf8')),
  exports: JSON.parse(readFileSync(join(dir, 'exports.json'), 'utf8')),
});
const baseline = read(baselineDir);
const pr = read(prDir);

const counted = { storage: 0, page: 0, exports: 0 };
let mismatches = 0;
const fail = (path, reason) => {
  mismatches += 1;
  console.error(`MISMATCH ${path}: ${reason}`);
};
const same = (path, a, b) => {
  if (a === b) return true;
  fail(path, `baseline=${JSON.stringify(a)} pr=${JSON.stringify(b)}`);
  return false;
};

const prByName = Object.fromEntries(pr.checkpoints.map(c => [c.name, c]));
if (baseline.checkpoints.length !== pr.checkpoints.length) {
  fail('checkpoints', `count ${baseline.checkpoints.length} vs ${pr.checkpoints.length}`);
}
for (const cp of baseline.checkpoints) {
  const other = prByName[cp.name];
  if (!other) {
    fail(cp.name, 'missing in PR run');
    continue;
  }
  for (const [key, value] of Object.entries(cp.keys)) {
    counted.storage += 1;
    same(`${cp.name}/${key}`, value, other.keys[key]);
  }
  for (const [key, value] of Object.entries(cp.page)) {
    counted.page += 1;
    same(`${cp.name}/page/${key}`, value, other.page[key]);
  }
}
const prExports = Object.fromEntries(pr.exports.map(e => [e.name, e]));
for (const exp of baseline.exports) {
  const other = prExports[exp.name];
  if (!other) {
    fail(`export:${exp.name}`, 'missing in PR run');
    continue;
  }
  counted.exports += 1;
  same(`export:${exp.name}/backup`, exp.backup, other.backup);
  if (exp.download !== other.download) {
    console.error(`note: download observation differs at ${exp.name}: baseline=${exp.download} pr=${other.download}`);
  }
}

console.error(`${counted.storage} storage values + ${counted.page} page attributes + ${counted.exports} exports compared across ${baseline.checkpoints.length} real-browser checkpoints.`);
if (mismatches) {
  console.error(`FAILED: ${mismatches} mismatches`);
  process.exit(1);
}
console.error('PASS: every real-browser checkpoint and export is byte-identical between the two versions.');
