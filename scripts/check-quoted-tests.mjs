// Fails when a doc quotes a test title that the spec file named beside it does
// not hold.
//
// The docs name a test by its exact title, in double quotes, after the spec
// file that holds it:
//
//   `checkout.e2e-spec.ts`: "answers 200 for an event that names no order, and records it"
//
// A renamed or moved test leaves that quote pointing at nothing, and no other
// check reads it. Plain Node with no dependency, because the Prose job runs no
// `npm ci`.

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
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

// A spec name in backticks. The path before the file name is optional.
const SPEC_NAME = /`[\w./-]*?([\w.-]+\.(?:e2e-)?spec\.ts)`/g;

// A spec name, then a comma or a colon, then one or more titles in double
// quotes, separated by a comma, a semicolon or "and".
const QUOTED = new RegExp(
  SPEC_NAME.source + /[,:]((?:\s*(?:,|;|and)?\s*"[^"\n]+")+)/.source,
  'g',
);
const QUOTE = /"([^"\n]+)"/g;

// it('title', ...) and it.each(table)('title', ...). A describe title names a
// group, not a test, so a quote of one fails.
const CALL = /(?<![\w.$])it(\.each)?\s*\(/g;

const lineOf = (text, at) => text.slice(0, at).split('\n').length;

// Returns each quoted title with the spec it follows and the index of its
// opening quote.
function quotedTitles(text) {
  const found = [];
  for (const anchor of text.matchAll(QUOTED)) {
    const listStart = anchor.index + anchor[0].length - anchor[2].length;
    for (const quote of anchor[2].matchAll(QUOTE)) {
      const at = listStart + quote.index;
      found.push({ title: quote[1], spec: anchor[1], at });
    }
  }
  return found;
}

// The control on each line: every quote that follows a spec name in the same
// table cell, or on the same line outside a table, must be one the extractor
// read as a title. Otherwise a title joined by a word the extractor does not
// know, such as "or", would drop out of the check silently.
function unreadQuotes(text, quotes) {
  const read = new Set(quotes.map((quote) => quote.at));
  const unread = new Map();
  for (const name of text.matchAll(SPEC_NAME)) {
    const from = name.index + name[0].length;
    const rest = text.slice(from);
    const end = rest.search(/[|\n]/);
    const cell = end === -1 ? rest : rest.slice(0, end);
    for (const quote of cell.matchAll(QUOTE)) {
      const at = from + quote.index;
      if (!read.has(at)) unread.set(at, { text: quote[1], spec: name[1], at });
    }
  }
  return [...unread.values()];
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
  const titles = new Set();
  for (const call of src.matchAll(CALL)) {
    let i = call.index + call[0].length;
    if (call[1]) {
      i = skipParens(src, i - 1);
      if (i === -1 || src[skipSpace(src, i)] !== '(') continue;
      i = skipSpace(src, i) + 1;
    }
    const literal = readString(src, skipSpace(src, i));
    if (literal) titles.add(literal.value);
  }
  return titles;
}

// Each spec file's name, mapped to the titles of its tests. The docs name a
// spec by its file name alone, so two specs may not share one.
function titlesBySpec() {
  const specs = new Map();
  for (const dir of SPEC_DIRS) {
    for (const name of readdirSync(join(ROOT, dir), { recursive: true })) {
      if (!name.endsWith('spec.ts')) continue;
      const file = basename(name);
      if (specs.has(file)) throw new Error(`Two spec files are named ${file}.`);
      specs.set(file, testTitles(readFileSync(join(ROOT, dir, name), 'utf8')));
    }
  }
  return specs;
}

const specs = titlesBySpec();
const failures = [];
let checked = 0;
for (const [doc, floor] of Object.entries(DOCS)) {
  const text = readFileSync(join(ROOT, doc), 'utf8');
  const quotes = quotedTitles(text);
  checked += quotes.length;
  if (quotes.length < floor) {
    failures.push(
      `${doc}: ${quotes.length} quoted titles, below the floor of ${floor}. ` +
        'Put each title right after its spec name, or change the floor.',
    );
  }
  for (const { title, spec, at } of quotes) {
    const where = `${doc}:${lineOf(text, at)}`;
    if (!specs.has(spec)) {
      failures.push(`${where}: ${spec} is not a spec file in test/ or src/.`);
    } else if (!specs.get(spec).has(title)) {
      failures.push(
        `${where}: "${title}" is not the title of an it( in ${spec}.`,
      );
    }
  }
  for (const { text: quote, spec, at } of unreadQuotes(text, quotes)) {
    failures.push(
      `${doc}:${lineOf(text, at)}: "${quote}" follows ${spec} but was not ` +
        'read as a title. Join titles with a comma, a semicolon or "and".',
    );
  }
}

for (const failure of failures) console.error(failure);
console.log(
  `Checked ${checked} quoted test titles in ${Object.keys(DOCS).length} docs ` +
    `against the it( titles of ${specs.size} spec files. ` +
    `${failures.length} failed.`,
);
process.exitCode = failures.length ? 1 : 0;
