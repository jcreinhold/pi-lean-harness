---
name: lean-proof-workflow
description: How to prove Lean 4 goals with the lean-harness tools (lean_state, lean_search, lean_try, lean_apply, lean_verify) — one stateful protocol, not ad-hoc file edits.
---

# Lean Proof Workflow

The `pi-lean-harness` extension exposes five tools backed by a running
`lean-host-mcp` server. They share one proof focus, one goal fingerprint, and
one ledger of successes and failures. Treat them as a single stateful
protocol; do not edit `.lean` proof blocks with generic file-edit tools.

## The loop

1. **Focus and observe — `lean_state`.**
   Pass `file` (project-relative `.lean` path) and `declaration`
   (fully-qualified name) the first time. This sets the shared focus every
   other tool reuses. Read the goals, diagnostics, and the "Previous failures
   on this state" list before choosing a tactic.

2. **Find lemmas — `lean_search`.**
   With no arguments it searches for the focused goal and returns ranked
   candidates with exact types, match reasons, and suggested tactic snippets.
   Use `for: "text"` with a `query` for goal text outside the current focus.

3. **Test tactics — `lean_try`.**
   Batch several `candidates` in one call. Nothing is written to disk. Exact
   repeat failures are skipped automatically (the ledger remembers them per
   goal fingerprint). The default accept bar is `close`; use
   `accept: "progress"` when you are chaining steps.

4. **Commit — `lean_apply`.**
   Only apply candidates that succeeded in `lean_try`. The tool re-tests the
   candidate, refuses to run if the file or goal changed, splices the exact
   tested text, verifies the declaration, and rolls back on verification
   failure. After a successful apply, the goal has changed: call `lean_state`
   again before the next step.

5. **Gate — `lean_verify`.**
   Before declaring the task done, verify with `scope: "changed"` (checks the
   git-changed declarations) and read the coverage gaps. `has_sorry`,
   `has_unresolved_goals`, or `needs_build` mean the work is not finished.

## Rules

- Always `lean_state` before `lean_try`, and `lean_try` before `lean_apply`.
- Never retry a tactic the ledger shows as failed on the same goal; go back
  to `lean_search` for a different approach instead.
- Use `proofPosition` (`{kind: "index", index: n}`) to work at a later tactic
  boundary inside a multi-step proof; `lean_state` shows the valid
  boundaries when a selector does not resolve.
- The tools need a reachable `lean-host-mcp` server
  (`lean-host-mcp serve --bind 127.0.0.1:8765`). If calls fail with a
  connection error, tell the user to start the server inside the Lake project.
- Do not bypass the harness by editing proof text with `edit`/`write`: those
  edits skip trial, freshness checks, verification, and the ledger.
