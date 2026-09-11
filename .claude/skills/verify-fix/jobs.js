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
//
// It matches indentation rather than parsing YAML, so a workflow written at a
// different indentation yields nothing for a job. Every count below is
// therefore printed even when it is zero, because a silent zero and a job with
// no steps read the same, and only one of them is the truth.
const fs = require('fs');

const file = process.argv[2] || '.github/workflows/ci.yml';

let text;
try {
  text = fs.readFileSync(file, 'utf8');
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  console.error(`Cannot read the workflow at ${file}: ${reason}`);
  console.error('Pass the path as the first argument, or run from the repository root.');
  process.exit(2);
}

const lines = text.split('\n');

let sawJobsKey = false;
let inJobs = false;
let job = null;
let jobCount = 0;
let stepsInJob = 0;

function closeJob() {
  if (job !== null) {
    console.log(`   ${stepsInJob} steps`);
  }
}

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];

  if (/^jobs:\s*$/.test(line)) {
    sawJobsKey = true;
    inJobs = true;
    continue;
  }
  if (!inJobs) continue;
  // A line in column zero ends the jobs block.
  if (/^\S/.test(line)) break;

  const jobKey = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
  if (jobKey) {
    closeJob();
    job = jobKey[1];
    jobCount += 1;
    stepsInJob = 0;
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

  stepsInJob += 1;
  const [, kind, rest] = step;
  if (kind === 'uses') {
    console.log(`   uses  ${rest.split('@')[0]}`);
    continue;
  }

  // `run: |` puts the command on the lines that follow. The first non-blank
  // one stands for the block, and it can be a comment rather than the command,
  // so the ellipsis marks the line as an excerpt and not the step itself.
  let command = rest;
  if (command === '|' || command === '>' || command === '|-' || command === '>-') {
    const next = lines.slice(i + 1).find((l) => l.trim() !== '');
    command = next === undefined ? '(empty block)' : `${next.trim()} ...`;
  }
  console.log(`   run   ${command}`);
}

closeJob();

console.log(`\n${jobCount} jobs in ${file}`);

// A zero here is a finding, not an absence. Say which of the two it is.
if (!sawJobsKey) {
  console.error(`No 'jobs:' key in ${file}. This is not a workflow file.`);
  process.exit(1);
}
if (jobCount === 0) {
  console.error(
    `A 'jobs:' key is present but no job matched. This script expects job keys ` +
      `indented by two spaces; check the indentation in ${file}.`,
  );
  process.exit(1);
}
