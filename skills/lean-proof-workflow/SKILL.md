---
name: lean-proof-workflow
description: How to prove Lean 4 goals with the lean-harness tools (lean_state, lean_search, lean_try, lean_apply, lean_verify) — one stateful protocol, not ad-hoc file edits.
---

# Lean Proof Workflow

The `pi-lean-harness` extension exposes five tools backed by a running `lean-host-mcp` server. They share one proof
focus, one goal fingerprint, and one ledger of successes and failures. Treat them as a single stateful protocol; do not
edit `.lean` proof blocks with generic file-edit tools.

## Diagnosis before tactics

On hard formalization the bottleneck is almost never "find the right tactic." It is API discovery, abstraction level,
and decomposition. The tools below are fast once you know what to prove; they are slow when you flail. So before the
first `lean_try`:

1. **Read the goal as mathematics.** Call `lean_state` and *look* before acting. Classify the goal: equality of
   elements, existence, implication, commutative diagram, membership, inequality? Note the type universes and coercions
   (`ℕ` vs `ℤ` vs `Int`, `Fin n` vs `ℕ`, `↑R` vs `R`) — mismatches here are the most common silent blocker. Note which
   hypotheses you suspect are irrelevant (you can often drop them in a scratch copy to test). The shape of the goal
   dictates the approach; acting before you see the shape wastes trials.

2. **Search before you try.** For any goal involving named objects — a construction, a lemma, a specific ring or map —
   call `lean_search` (no args searches the focused goal; `for: "text"` with a `query` searches goal text) *before*
   `lean_try`. The library usually has the move; your job is finding it, not inventing it. To read a candidate's exact
   statement before rewriting with it, pass `names: ["Fully.Qualified.name"]` (max 8): whether an equation is pointwise
   or a function equality, whether a lemma is `↔` or `→`, decides whether `rw` can use it. Never guess `@[simps]`
   projection names. Return to search whenever a trial fails — not to more tactics.

3. **Reduce to the bottleneck.** If a proof has several steps and you can do all but one, do the ones you know and
   isolate the one you can't. Spend search and thinking on the bottleneck, not on re-proving what you already
   understand.

4. **Classify each failure.** A trial or verify failure is one of:
   - **wrong tactic** — the goal is right, try a different move;
   - **wrong direction** — the lemma exists but you need its converse or `symm`/`comm` form; search again;
   - **wrong abstraction level** — you stated the goal too generally (every step fights the generality) or too
     specifically (no reuse); restate;
   - **API mismatch** — the lemma exists with different hypotheses or a different type; you need a transport, an
     `equiv`, or a coercion bridge, not another tactic;
   - **genuinely hard** — no library move suffices; you need a new lemma, which means back to `lean-plan` or
     `proof-review`, not more `lean_try`.

   Treating every failure as "wrong tactic" is how context fills with failed
   attempts on a problem that was never tactical.

5. **Stop rule.** Three genuinely distinct approaches failed → the problem is upstream (decomposition or API
   understanding), not tactical. Stop flailing, go to `lean-plan` (re-audit the route) or `proof-review` (check the
   math). Do not try a fourth tactic variant.

## Match the workflow to where the uncertainty is

There is no single default. Pick the mode by what you don't yet know.

- **Structure clear, execution uncertain → draft-and-verify.** Scaffold the declaration with a `sorry` body (via
  `edit`/`write` — scaffolding a *statement* is fine), then `lean_apply` with `skipTrial: true` and the full proof body.
  The harness splices the body in place of the `sorry`, verifies the whole declaration, and rolls the file back if
  verification fails. One transaction, no per-tactic round-trips, no broken file left behind. This sidesteps the
  multi-line term-continuation parsing issue (see Pitfalls).

- **Structure uncertain, sub-goal types unsure → skeleton-first.** Write the whole proof with `sorry` placeholders for
  the hard sub-steps, then `lean_verify` the declaration (or `lean_apply` each `sorry` body with `skipTrial: true`).
  This catches type errors in the skeleton *before* you invest in sub-proofs that turn out to be mistyped — the most
  expensive failure to discover late. Once the skeleton verifies, fill the `sorry`s one at a time, `lean_verify` after
  each.

- **One step is the blocker → trial loop.** `lean_state` → `lean_try` (batch several candidates in one call; nothing is
  written) → `lean_apply` (without `skipTrial`) with the winner. Use this to choose between approaches for a single
  step, or to get a verdict without risking the file. Do not drive a long proof through the trial loop one tactic at a
  time: each step costs a state→try→apply round-trip and floods the context with failed attempts.

- **The whole approach is uncertain → not a harness task.** If you cannot sketch the proof structure, you do not have a
  route; use `lean-plan` and `proof-review` (or the project's proof-notes) to find the decomposition before touching
  these tools.

**`lean_verify` is the gate in every mode.** A declaration is not done until it accepts with a clean axiom report: no
`sorry`, no `has_unresolved_goals`, no `needs_build`, no new axioms. `lean_apply` runs this gate internally; for work
written directly, call `lean_verify scope: "changed"` yourself, and verify per-declaration early in multi-declaration
modules so a type error in one helper doesn't invalidate work on its dependents.

## The tools

- **`lean_state`** — focus and observe. Pass `file` + `declaration` the first time; later calls reuse the focus. Read
  goals, diagnostics, and "Previous failures" before choosing. Also use it to *change* focus (pass the new
  `file`/`declaration`).

- **`lean_search`** — find lemmas. Ranked candidates with exact types, match reasons, and suggested tactics.
  `for: "text"` + `query` for goal text outside the focus; `names: [...]` to read exact statements before rewriting.

- **`lean_try`** — test tactics in memory, no file writes. Batch several candidates per call. Nothing is committed;
  outcomes enter the ledger.

- **`lean_apply`** — the only tool that writes source. Splices the candidate, verifies the declaration, rolls back on
  failure. `skipTrial: true` for a multi-line body (no trial re-test; verify is the safety net). Without `skipTrial`, it
  re-tests first and refuses non-progressing candidates.

- **`lean_verify`** — gate. `scope: "focus"` (focused decl), `"declaration"` (explicit), `"file"` (whole file), or
  `"changed"` (git-changed set). Read coverage gaps and the axiom report.

## Pitfalls

- **`proofPosition` does not persist across calls.** A later `lean_try`/ `lean_apply` that omits `proofPosition` always
  targets the pristine entry goal, not a position set earlier. Pass `proofPosition` on every call that needs a
  non-default boundary.

- **One tactic whose *term* spans lines is brittle in a trial.** A candidate with a continuation line starting with `(`,
  `.`, `|`, `·`, or an operator often parses as two tactics and reports `unknown tactic` on the continuation. Flatten
  the term to one line, or indent the continuation deeper than the tactic's column. Multi-tactic candidates (each line a
  complete tactic at the same indent) are fine. The `skipTrial: true` path avoids this entirely — it does not parse the
  candidate in the trial engine.

- **The ledger keys failures on the goal fingerprint *and* the file's source hash.** Do not retry a tactic the ledger
  shows failed on the same goal and the same source; go back to `lean_search`. An edit that leaves the goal text
  unchanged but changes the source (e.g. adding an import to resolve a name) correctly unlocks a now-valid retry.

- **Lean errors are diagnosis, not pass/fail.** "type mismatch, expected `Ideal R` got `Ideal ↑R`" = universe/embedding
  issue. "unknown identifier" = wrong namespace or missing import. `rw`/`simp` stuck = wrong lemma direction or a def
  that needs `show`/`change` to unfold. Read the error type before trying another tactic.

## Rules

- Always `lean_state` before `lean_try`, and `lean_try` before `lean_apply` (without `skipTrial`). For `lean_apply` with
  `skipTrial: true`, `lean_state` first is still required — the freshness gate refuses to run when the file or goal
  changed since the last observation.
- Never edit proof text with `edit`/`write` to bypass the harness: those edits skip trial, freshness, verification, and
  the ledger. (Scaffolding a new declaration *statement* with a `sorry` body via `edit`/`write` is fine — fill the body
  through `lean_apply`.)
- The tools need a reachable `lean-host-mcp` server (`lean-host-mcp serve --bind 127.0.0.1:8765`). If calls fail with a
  connection error, tell the user to start the server inside the Lake project.
