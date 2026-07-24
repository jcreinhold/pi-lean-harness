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
   To inspect a specific lemma before rewriting with it, pass
   `names: ["Fully.Qualified.name"]` (max 8): you get the exact statement,
   docstring, and attributes — whether an equation is pointwise or a function
   equality matters for `rw`. Never guess `@[simps]` projection names.

3. **Test tactics — `lean_try`.**
   Batch several *alternative* `candidates` in one call. Nothing is written to
   disk. Exact repeat failures are skipped automatically (the ledger remembers
   them per goal fingerprint). The default accept bar is `close`; use
   `accept: "progress"` when you are chaining steps.
   Prefer one tactic per candidate so a failure localizes to a single step;
   when a multi-tactic candidate fails, decompose it rather than re-guessing
   a larger script. When a prefix candidate succeeds, commit it with
   `lean_apply` and `require: "make_progress"`, then re-observe with
   `lean_state` — do not keep composing longer candidates blind.
   **The brittle case is one tactic whose *term* spans lines**: a candidate
   with a continuation line starting with `(`, `.`, `|`, `·`, or an operator
   often parses as two separate tactics in a trial and reports `unknown
   tactic` on the continuation. Flatten the term onto one line, or indent the
   continuation *deeper* than the tactic's column. Multi-tactic candidates
   (each line a complete tactic at the same indent) are fine.

4. **Commit — `lean_apply`.**
   Only apply candidates that succeeded in `lean_try`. The tool re-tests the
   candidate, refuses to run if the file or goal changed, splices the exact
   tested text, verifies the declaration, and rolls back on verification
   failure. A `sorry`/`admit` tactic at the focused boundary is a scaffold:
   `lean_apply` *replaces* it with the candidate (other sorries elsewhere in
   the file do not block verification, which is declaration-scoped). After a
   successful apply, the goal has changed: call `lean_state` again before the
   next step.

5. **Gate — `lean_verify`.**
   Before declaring the task done, verify with `scope: "changed"` (checks the
   git-changed declarations) and read the coverage gaps. `has_sorry`,
   `has_unresolved_goals`, or `needs_build` mean the work is not finished.

## Rules

- Always `lean_state` before `lean_try`, and `lean_try` before `lean_apply`.
- Never retry a tactic the ledger shows as failed on the same goal **and
  the same source**; go back to `lean_search` for a different approach
  instead. (The ledger keys failures on the goal fingerprint *and* the file's
  source hash, so an edit that leaves the goal text unchanged — e.g. adding
  an import to resolve a name — correctly unlocks a now-valid retry.)
- Use `proofPosition` (`{kind: "index", index: n}`) to work at a later tactic
  boundary inside a multi-step proof; `lean_state` shows the valid
  boundaries when a selector does not resolve. **The position does not
  persist across calls**: a later `lean_try`/`lean_apply` that omits
  `proofPosition` always targets the pristine entry goal, not the position
  set on a previous call. Pass `proofPosition` on every call that needs a
  non-default boundary.
- The tools need a reachable `lean-host-mcp` server
  (`lean-host-mcp serve --bind 127.0.0.1:8765`). If calls fail with a
  connection error, tell the user to start the server inside the Lake project.
- Do not bypass the harness by editing proof text with `edit`/`write`: those
  edits skip trial, freshness checks, verification, and the ledger.
  (Scaffolding a new declaration *statement* with a `sorry` body via
  `edit`/`write` is fine — fill the body through `lean_apply`.)
