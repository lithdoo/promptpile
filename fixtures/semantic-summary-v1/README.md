# Semantic summary v1 fixtures

These fixtures are the deterministic, human-reviewable quality gate for semantic
compression. A conforming summary must retain the goal, constraint, decision,
tool finding, completed work, unresolved work, failed approach, and next action.
Every retained statement cites one or more archived conversation indices.

`coding-session/expected-summary.json` is provider output, not a golden Markdown
string. Tests validate and render it through the production schema so formatting
and provenance rules cannot be bypassed.
