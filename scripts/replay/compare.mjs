// Compares two replay snapshot files (baseline vs PR) for byte-exact equality
// of every checkpoint's raw storage strings, page side effects, and exports.
//   node scripts/replay/compare.mjs <baseline.json> <pr.json>
import { readFileSync } from 'node:fs';

const [baselinePath, prPath] = process.argv.slice(2);
if (!baselinePath || !prPath) {
  console.error('usage: node scripts/replay/compare.mjs <baseline.json> <pr.json>');
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const pr = JSON.parse(readFileSync(prPath, 'utf8'));

let mismatches = 0;
const counted = { storage: 0, page: 0, exports: 0 };

function fail(path, reason) {
  mismatches += 1;
  console.error(`MISMATCH ${path}: ${reason}`);
}

function compareValue(path, a, b) {
  if (path.includes('/page/')) counted.page += 1;
  else if (path.includes('/export:')) counted.exports += 1;
  else counted.storage += 1;
  if (a === b) return;
  fail(path, `baseline=${JSON.stringify(a)} pr=${JSON.stringify(b)}`);
}

const scenariosBy = list => {
  const byName = {};
  for (const s of list) {
    if (s.name in byName) {
      fail(`scenario:${s.name}`, 'duplicate scenario name');
      continue;
    }
    byName[s.name] = s;
  }
  return byName;
};
const baseScenarios = scenariosBy(baseline.scenarios);
const prScenarios = scenariosBy(pr.scenarios);

for (const name of Object.keys(baseScenarios)) {
  const base = baseScenarios[name];
  const other = prScenarios[name];
  if (!other) {
    fail(`scenario:${name}`, 'missing in PR run');
    continue;
  }
  const checkpointNames = new Set();
  for (const cp of base.checkpoints) {
    if (checkpointNames.has(cp.name)) {
      fail(`scenario:${name}/checkpoint:${cp.name}`, 'duplicate checkpoint name in baseline run');
    }
    checkpointNames.add(cp.name);
  }
  const otherBy = {};
  for (const cp of other.checkpoints) {
    if (cp.name in otherBy) {
      fail(`scenario:${name}/checkpoint:${cp.name}`, 'duplicate checkpoint name in PR run');
      continue;
    }
    otherBy[cp.name] = cp;
  }
  for (const cp of base.checkpoints) {
    const otherCp = otherBy[cp.name];
    if (!otherCp) {
      fail(`scenario:${name}/checkpoint:${cp.name}`, 'missing in PR run');
      continue;
    }
    for (const key of Object.keys(cp.keys)) {
      compareValue(`scenario:${name}/checkpoint:${cp.name}/${key}`, cp.keys[key], otherCp.keys[key]);
    }
    compareValue(`scenario:${name}/checkpoint:${cp.name}/page/lang`, cp.page.lang, otherCp.page.lang);
    compareValue(`scenario:${name}/checkpoint:${cp.name}/page/title`, cp.page.title, otherCp.page.title);
    compareValue(`scenario:${name}/checkpoint:${cp.name}/page/bodyClass`, cp.page.bodyClass, otherCp.page.bodyClass);
  }
  const otherExportsBy = Object.fromEntries((other.exports || []).map(e => [e.name, e.backup]));
  for (const exp of base.exports || []) {
    if (!exp.backup || !exp.backup.trim()) {
      fail(`scenario:${name}/export:${exp.name}`, 'empty backup content in baseline run');
      continue;
    }
    if (!(exp.name in otherExportsBy)) {
      fail(`scenario:${name}/export:${exp.name}`, 'missing in PR run');
      continue;
    }
    if (!otherExportsBy[exp.name] || !otherExportsBy[exp.name].trim()) {
      fail(`scenario:${name}/export:${exp.name}`, 'empty backup content in PR run');
      continue;
    }
    compareValue(`scenario:${name}/export:${exp.name}`, exp.backup, otherExportsBy[exp.name]);
  }
}

const baseCount = baseline.scenarios.reduce((sum, s) => sum + s.checkpoints.length, 0);
console.error(`${baseCount} checkpoints per side: ${counted.storage} storage values + ${counted.page} page attributes + ${counted.exports} exports compared.`);
if (mismatches) {
  console.error(`FAILED: ${mismatches} mismatches`);
  process.exit(1);
}
console.error('PASS: every checkpoint and export is byte-identical between the two versions.');
