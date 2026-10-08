// Fails when a doc quotes a test title that no spec declares.
//
// The docs name a test by its exact title, in double quotes, after the spec
// file that holds it:
//
//   `checkout.e2e-spec.ts`: "answers 200 for an event that names no order, and records it"
//
// A renamed test leaves that quote pointing at nothing, and no other check
// reads it. Plain Node with no dependency, because the Prose job runs no
// `npm ci`.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Each file that quotes titles, with the number of quotes it holds today. The
// floor is the control: an extractor that reads nothing fails here instead of
// passing on an empty list. Change a floor when a file gains or loses a quote.
const DOCS = {
  'docs/product.md': 7,
  'docs/qa/risk-register.md': 5,
  'docs/qa/test-map.md': 6,
};

const SPEC_DIRS = ['test', 'src'];

// A spec name in backticks, then a comma or a colon, then one or more titles in
// double quotes, separated by a comma, a semicolon or "and".
const QUOTED =
  /`[\w./-]*?([\w.-]+\.(?:e2e-)?spec\.ts)`[,:]((?:\s*(?:,|;|and)?\s*"[^"\n]+")+)/g;
const TITLE = /"([^"\n]+)"/g;

// it('title', ...), describe('title', ...), and the .each form of both, whose
// title follows the table: it.each(table)('title', ...).
const CALL = /(?<![\w.$])(?:it|describe)(\.each)?\s*\(/g;

function quotedTitles(text) {
  const found = [];
  for (const anchor of text.matchAll(QUOTED)) {
    const listStart = anchor.index + anchor[0].length - anchor[2].length;
    for (const quote of anchor[2].matchAll(TITLE)) {
      const at = listStart + quote.index;
      found.push({
        title: quote[1],
        spec: anchor[1],
        line: text.slice(0, at).split('\n').length,
      });
    }
  }
  return found;
}

// Reads the string literal that opens at `start`, or returns null.
function readString(src, start) {
  const quote = src[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let value = '';
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === '\\') {
      value += src[++i];
    } else if (src[i] === quote) {
      return { value, end: i + 1 };
    } else {
      value += src[i];
    }
  }
  return null;
}

// Returns the index just past the parenthesis that closes the one at `start`.
function skipParens(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i === -1) return -1;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 1;
      if (i === 0) return -1;
    } else if (c === "'" || c === '"' || c === '`') {
      const literal = readString(src, i);
      if (!literal) return -1;
      i = literal.end - 1;
    } else if (c === '(') {
      depth++;
    } else if (c === ')' && --depth === 0) {
      return i + 1;
    }
  }
  return -1;
}

function skipSpace(src, i) {
  while (/\s/.test(src[i] ?? '')) i++;
  return i;
}

function testTitles(src) {
  const titles = [];
  for (const call of src.matchAll(CALL)) {
    let i = call.index + call[0].length;
    if (call[1]) {
      i = skipParens(src, i - 1);
      if (i === -1 || src[skipSpace(src, i)] !== '(') continue;
      i = skipSpace(src, i) + 1;
    }
    const literal = readString(src, skipSpace(src, i));
    if (literal) titles.push(literal.value);
  }
  return titles;
}

function specFiles() {
  return SPEC_DIRS.flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true })
      .filter((name) => name.endsWith('spec.ts'))
      .map((name) => join(ROOT, dir, name)),
  );
}

const files = specFiles();
const known = new Set(
  files.flatMap((file) => testTitles(readFileSync(file, 'utf8'))),
);

const failures = [];
let checked = 0;
for (const [doc, floor] of Object.entries(DOCS)) {
  const quotes = quotedTitles(readFileSync(join(ROOT, doc), 'utf8'));
  checked += quotes.length;
  if (quotes.length < floor) {
    failures.push(
      `${doc}: ${quotes.length} quoted titles, below the floor of ${floor}. ` +
        'Put each title right after its spec name, or change the floor.',
    );
  }
  for (const { title, spec, line } of quotes) {
    if (!known.has(title)) {
      failures.push(
        `${doc}:${line}: "${title}" (after ${spec}) matches no it( or ` +
          `describe( title in ${SPEC_DIRS.join('/ or ')}/.`,
      );
    }
  }
}

for (const failure of failures) console.error(failure);
console.log(
  `Checked ${checked} quoted test titles in ${Object.keys(DOCS).length} docs ` +
    `against ${known.size} titles in ${files.length} spec files. ` +
    `${failures.length} failed.`,
);
process.exitCode = failures.length ? 1 : 0;
