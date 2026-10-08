# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root, or
- **`GLOSSARY-MAP.md`** at the repo root if it exists: it points at one `GLOSSARY.md` per context. Read each one relevant to the topic.
- **`docs/decisions/`**: this repo's ADR folder (not `docs/adr/`). Read the ADRs that touch the area you're about to work in. Code cites them as `ADR <n>` or `DECISIONS <n>`; resolve a citation to its file before you change the code beside it.
- **`CLAUDE.md`, "Words this file uses"**: the few terms defined before `GLOSSARY.md` existed.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (most repos):

```
/
├── GLOSSARY.md
├── docs/decisions/
│   ├── 0001-opaque-refresh-token-hashed-with-a-pepper.md
│   └── 0002-a-device-is-a-family-of-refresh-tokens.md
└── src/
```

This repo is single-context, so there is no `GLOSSARY-MAP.md`.

## Writing an ADR

These rules replace the `domain-modeling` skill's `ADR-FORMAT.md`, which assumes `docs/adr/`.

- **Folder and name:** `docs/decisions/NNNN-slug.md`, never `docs/adr/`.
- **Number:** the highest existing number plus one. Numbers are never reused (12 is retired).
- **Shape:** copy an existing record, for example `0037-promo-codes-count-at-checkout-and-snapshot-on-the-order.md`:

  ```
  # <n>. <Title as a sentence>

  Status: accepted
  Date: YYYY-MM-DD

  ## Context
  ## Options
  ## Decision
  ## Consequences
  ```

  Status and Date are plain lines, not frontmatter, and every section is required.

- **Index:** add a line under its topic in `docs/decisions/README.md`.
- **Prose:** it must pass Vale; the `Prose` job runs it over `docs/decisions`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR 24 (the webhook is the only writer of `paid`), but worth reopening because…_
