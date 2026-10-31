---
description: Reason through the task in an explicit scratchpad before answering or acting
---

Work through $ARGUMENTS in two visible phases.

## Phase 1 — Reasoning

Write a concise scratchpad under a `### Reasoning` heading. Cover:

- Restate the task and what "done" looks like.
- List the constraints, assumptions, and unknowns. If a fact is missing, check the
  codebase or a source before guessing.
- Consider two or three approaches and their tradeoffs, then choose one and say why.
- For code changes, name the files involved and the order of edits.

This phase is a plan, not the deliverable. Do not make edits while writing it.

## Phase 2 — Result

Carry out the plan and put the outcome under a `### Result` heading.

- Question: answer directly, then flag anything you are unsure about.
- Code change: make the edits, then report what changed and how you verified it.

End with a single line: `Confidence: high|medium|low — <biggest risk>`.
