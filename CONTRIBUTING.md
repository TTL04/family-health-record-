# Contributing
How this team works. Written down so that a rule we agreed in conversation is checkable in the repository.
## Branching
One branch per issue, named `feat/us-xx-short-name`. Nothing is committed to `main` directly; `main` is protected by the ruleset `main-protection`.
## Pull requests
Every pull request states three things:
1. **What** changed
2. **Why** it is needed
3. **How to verify** — the exact command a reviewer runs
The body ends with `Closes #<issue>` so the requirement closes when the change merges.
## Review
A review is not an approval. Every review contains:
1. One specific observation about the code or the document
2. One question the author has to answer
An approval on its own is treated as an incomplete review. This rule exists because our first two reviews were the single word "good", which tells a reader nothing about whether anyone looked.
## Before merge
- `npm test` passes locally
- One approval from someone other than the author
- Every conversation resolved
