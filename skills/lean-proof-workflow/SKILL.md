---
name: lean-proof-workflow
description: How to prove Lean 4 goals with the lean-harness tools (lean_state, lean_search, lean_try, lean_apply, lean_verify) — one stateful protocol, not ad-hoc file edits.
---

# Lean Proof Workflow

The `pi-lean-harness` extension exposes five tools backed by a running
`lean-host-mcp` server. They share one proof focus, one goal fingerprint, and
one ledger of successes and failures. Treat them as a single stateful
protocol; do not edit `.lean` proof blocks with generic file-edit tools.

## Two workflows, one default

**Draft-and-verify (the default for any proof longer than one or two tactics).**
Scaffold the declaration with a `sorry` body (via `edit`/`write` — scaffolding
a *statement* is fine), then call `lean_apply` with `skipTrial: true` and the
full proof body as the candidate. The harness splices the body in place of the
`sorry`, verifies the whole declaration, and rolls the file back to its
original bytes if verification fails. One transaction, no per-tactic
round-trips, no broken file left behind. When verification fails, read the
diagnostics, fix the body, and re-apply. This is cheaper, safer, and more
robust than the trial loop for multi-step proofs — and it sidesteps the
multi-line term-continuation parsing issue that the trial path has.

**Trial loop (for a single uncertain tactic or a choice between alternatives).**
Call `lean_state` to observe the goal, `lean_try` to batch several candidate
tactics in one call (nothing is written to disk), then `lean_apply` (without
`skipTrial`) to commit the winner. Use this when you are choosing between
approaches for one step, or when you want a verdict on a tactic without
risking the file. Do not drive a long proof through the trial loop one tactic
at a time: each step costs a `lean_state` → `lean_try` → `lean_apply`
round-trip, and the context fills with failed attempts before the proof is
done.

**`lean_verify` is the gate either way.** A declaration is not done until
`lean_verify` accepts it with a clean axiom report (no `sorry`, no new axioms,
no debug options). For a draft-and-verify commit, `lean_apply` runs this gate
internally; for work written directly to the file, call `lean_verify`
yourself.

## The loop

1. **Focus and observe — `lean_state`.**
   Pass `file` (project-relative `.lean` path) and `declaration`
   (fully-qualified name) the first time. This sets the shared focus every
   other tool reuses. Read the goals, diagnostics, and the "Previous failures"
   list before choosing a tactic.

2. **Find lemmas — `lean_search`.**
   With no arguments it searches for the focused goal and returns ranked
   candidates with exact types, match reasons, and suggested tactic snippets.
   Use `for: "text"` with a `query` for goal text outside the current focus.
   To inspect a specific lemma before rewriting with it, pass
   `names: ["Fully.Qualified.name"]` (max 8): you get the exact statement,
   docstring, and attributes — whether an equation is pointwise or a function
   equality matters for `rw`. Never guess `@[simps]` projection names.

3. **Commit the proof — `lean_apply`.**
   - **Multi-step proof (default):** scaffold `sorry`, then
     `lean_apply` with `skipTrial: true` and the full body. Verify + rollback
     is the safety net; the trial re-test is skipped because it can misparse
     multi-line terms.
   - **Single uncertain tactic:** `lean_try` first, then `lean_apply` (no
     `skipTrial`) with the winner. The harness re-tests, splices, verifies,
     and rolls back on failure. A `sorry`/`admit` at the boundary is replaced;
     anything else is inserted alongside.
   After a successful apply, the goal has changed: call `lean_state` again
   before the next step.

4. **Gate — `lean_verify`.**
   Before declaring the task done, verify with `scope: "changed"` (checks the
   git-changed declarations) and read the coverage gaps. `has_sorry`,
   `has_unresolved_goals`, or `needs_build` mean the work is not finished.

## Choosing the approach

Before committing to a proof structure, consider more than one. If the goal
admits genuinely different decompositions (direct calculation vs. reduction to
a lemma, induction vs. universal property, case split vs. transport along an
isomorphism), test the key step of each with `lean_try` before writing the
body. The trial loop is cheap for *choosing*; it is expensive for *executing*.
Once you know which decomposition works, commit the full body with
`skipTrial: true` in one transaction.

A route that ends at a lemma equivalent in strength to the target is not
progress unless you can prove that lemma. If the only way through is a
helper as strong as the target, stop and reconsider the decomposition rather
than filing the helper as a scaffold.

## Rules

- Always `lean_state` before `lean_try`, and `lean_try` before `lean_apply`
  (without `skipTrial`).
- For `lean_apply` with `skipTrial: true`, `lean_state` first is still
  required (the freshness gate refuses to run when the file or goal changed
  since the last observation).
- Never retry a tactic the ledger shows as failed on the same goal **and
  the same source**; go back to `lean_search` for a different approach
  instead. (The ledger keys failures on the goal fingerprint *and* the file's
  source hash, so an edit that leaves the goal text unchanged — e.g. adding
  an import to resolve a name — correctly unlocks a now-valid retry.)
- `proofPosition` does **not** persist across calls: a later `lean_try`/
  `lean_apply` that omits `proofPosition` always targets the pristine entry
  goal, not the position set on a previous call. Pass `proofPosition` on
  every call that needs a non-default boundary.
- **The brittle case is one tactic whose *term* spans lines**: a candidate
  with a continuation line starting with `(`, `.`, `|`, `·`, or an operator
  often parses as two separate tactics in a trial and reports `unknown
  tactic` on the continuation. Flatten the term onto one line, or indent the
  continuation *deeper* than the tactic's column. Multi-tactic candidates
  (each line a complete tactic at the same indent) are fine. The
  `skipTrial: true` path avoids this entirely because it does not parse the
  candidate in the trial engine.
- The tools need a reachable `lean-host-mcp` server
  (`lean-host-mcp serve --bind 127.0.0.1:8765`). If calls fail with a
  connection error, tell the user to start the server inside the Lake project.
- Do not bypass the harness by editing proof text with `edit`/`write`: those
  edits skip trial, freshness checks, verification, and the ledger.
  (Scaffolding a new declaration *statement* with a `sorry` body via
  `edit`/`write` is fine — fill the body through `lean_apply`.)
