# Agent documentation

This file is the only one at the top level of `agent-docs/`. Everything else
belongs in one of these places:

- `architecture-decision-records/` holds one decision per file, named
  `NNNN-slug.md`, and records why the design is what it is. Read the relevant
  one before "simplifying" a design that looks accidental.
- Record an approach that was tried and declined as a sentence, with the number,
  at the code that would try it again, or as an ADR if the decision deserves a
  record.
- Leave out what a session did and which commits it made; git already holds
  that.

Cite a doc by its path, so that a grep finds every citation when the doc moves.
