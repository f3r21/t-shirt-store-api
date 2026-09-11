// List the jobs of a GitHub workflow, and the steps inside each one.
//
// Usage: node .claude/skills/verify-fix/jobs.js [path to a workflow file]
//
// This reads the file with node alone. A YAML library would be shorter, but
// `js-yaml` resolves in this repository only because a dependency hoists it,
// so a dependency bump takes it away and this script goes with it.
//
// It reports `uses` steps as well as `run` steps. A check can arrive as an
// action: the Prose job runs Vale that way, and a list of `run` steps alone
// misses the check that job exists for.
const fs = require('fs');

const file = process.argv[2] || '.github/workflows/ci.yml';
const lines = fs.readFileSync(file, 'utf8').split('\n');

let inJobs = false;
let job = null;

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];

  if (/^jobs:\s*$/.test(line)) {
    inJobs = true;
    continue;
  }
  if (!inJobs) continue;
  // A line in column zero ends the jobs block.
  if (/^\S/.test(line)) break;

  const jobKey = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
  if (jobKey) {
    job = jobKey[1];
    console.log(`== ${job}`);
    continue;
  }
  if (!job) continue;

  const name = line.match(/^ {4}name:\s*(.+?)\s*$/);
  if (name) {
    console.log(`   name  ${name[1]}`);
    continue;
  }

  const step = line.match(/^\s+-?\s*(run|uses):\s*(.*?)\s*$/);
  if (!step) continue;

  const [, kind, rest] = step;
  if (kind === 'uses') {
    console.log(`   uses  ${rest.split('@')[0]}`);
    continue;
  }

  // `run: |` puts the command on the lines that follow.
  let command = rest;
  if (command === '|' || command === '>' || command === '|-' || command === '>-') {
    const next = lines.slice(i + 1).find((l) => l.trim() !== '');
    command = next === undefined ? '(empty block)' : `${next.trim()} ...`;
  }
  console.log(`   run   ${command}`);
}
