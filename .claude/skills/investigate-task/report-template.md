# Report template

Fill each section. Keep the headings. Write "None" under a section that has no entry.

```markdown
## Request

One sentence: what the request asks for.

## Files

- `path:line`: the role of this line in the requested behaviour

## Findings

- The observation, its evidence (a `path:line` from Files, or the search that produced it),
  and the consumers it affects
- For an empty search: the pattern, the scope searched, and the known-match control with its
  result

## Test plan

- Behaviour → test file → command → required services (none, or the three containers)
- Coverage gaps: each uncovered behaviour, and the file that would hold its test
- Unresolved questions
```
