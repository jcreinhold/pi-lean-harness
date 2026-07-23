# pi-lean-harness

A [Pi](https://github.com/badlogic/pi-mono) extension that gives the agent a
small, stateful Lean 4 proof toolkit. It wraps
[`lean-host-mcp`](https://github.com/jcreinhold/lean-host-mcp) behind five
native tools that share one proof focus, one goal fingerprint, and one ledger
of proof attempts — and it owns the transactional parts a raw MCP server
cannot: freshness checks, atomic source edits, verification, and rollback.

The agent never sees raw MCP tools and never chooses between "MCP", "LSP", or
"shell". It sees only:

| Tool          | What it does |
| ------------- | ------------ |
| `lean_state`  | Current proof situation: goals, diagnostics, source freshness, and previous failed attempts for the focused declaration. Also sets the shared focus. |
| `lean_search` | Ranked lemmas/definitions for the current goal (or explicit goal text) with exact types, match reasons, suggested tactics, docstrings, and usage examples. |
| `lean_try`    | Non-mutating tactic trials against the focused goal. Batched, deduplicated against the ledger, outcomes recorded. |
| `lean_apply`  | Compound transaction: re-test → freshness check → atomic edit → verify → rollback on failure. The only tool that writes source. |
| `lean_verify` | Verification gate for the focused declaration, an explicit declaration, a file, or the git-changed set. |

## Setup

1. Install and build the backend (see its README):
   ```sh
   cargo install lean-host-mcp
   lean-host-mcp install-worker
   ```

2. Start the server inside your built Lake project:
   ```sh
   cd /path/to/lake/project
   lake build && lean-host-mcp serve --bind 127.0.0.1:8765
   ```
   The extension talks to the server over Streamable HTTP only (default
   `http://127.0.0.1:8765/mcp`). One server process serves every Pi session —
   the extension never spawns stdio servers, which keeps memory flat across
   parallel sessions.

3. Install the extension in Pi, e.g. add to `~/.pi/agent/settings.json`:
   ```json
   { "packages": ["github:jcreinhold/pi-lean-harness"] }
   ```
   or run `pi` from a local checkout during development.

4. Load the included `lean-proof-workflow` skill (shipped via `pi.skills`) so
   the agent learns the state → search → try → apply → verify loop.

## The proof protocol

`lean_apply` is not a renamed MCP call. It is a transaction:

```
lean_apply(candidate)
  1. Resolve the focused declaration and proof position.
  2. Confirm the file bytes and goal fingerprint have not changed.
  3. Re-test the exact candidate through lean_trial.
  4. Refuse when it fails or (by default) does not close the goal.
  5. Splice the exact tested text at the proof boundary, atomically.
  6. Verify the containing declaration through lean_verify.
  7. Roll back to the original bytes when verification fails
     (or keep the edit, per apply.onVerifyFailure).
  8. Record the outcome in the proof ledger.
```

All five tools share a `LeanSessionState` (focus, source/goal fingerprints,
successful steps, failed attempts, last verification). Snapshots travel in
tool-result details, so the state follows the session branch across forks,
compaction, and reloads. Repeated failed tactics are skipped automatically
when the goal hasn't changed.

## Configuration

Config file (`lean-harness` scope; see `schema.json`):

```json
{
  "leanHarness": {
    "server": {
      "url": "http://127.0.0.1:8765/mcp",
      "requestTimeoutMs": 30000,
      "project": "/optional/absolute/lake/root/override"
    },
    "apply": { "onVerifyFailure": "rollback" },
    "tools": { "enabled": true }
  }
}
```

- `apply.onVerifyFailure`: `"rollback"` (default) restores original bytes
  when post-edit verification fails; `"keep"` leaves the unverified edit.
- Interactive toggles: `/lean-harness:settings`.

## Commands

- `/lean-harness:settings` — toggle tools and the apply failure policy.
- `/lean-debug [status|raw-tools|focus|ledger]` — human-only inspection of the
  connection, backend tool list, current focus, and the proof ledger.

## Environment

No environment variables are read by the extension itself. The backend honors
its own (e.g. `LEAN_HOST_MCP_RESPONSE_CARRIER`); the extension parses both the
default text carrier and structured content.

## Limitations

- **HTTP transport only.** The extension attaches to an already-running
  server; it does not autostart or supervise `lean-host-mcp` (no PID locking,
  log capture, or crash recovery).
- **One focus at a time.** The shared focus is a single declaration/proof
  position per session branch.
- **Insertion-based edits.** `lean_apply` inserts new tactic lines at proof
  boundaries; it does not rewrite or delete existing tactic text.
- **Backend version lock.** The capability check requires the five semantic
  tools (`lean_context`, `lean_trial`, `lean_verify`, `lean_lookup`,
  `lean_status`); older servers fail fast with a clear error.
- Raw backend tools are never registered with the agent (`exposeRawBackendTools`
  is reserved for a future debug surface). Use `/lean-debug raw-tools` to
  inspect the backend as a human.

## Development

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

Tests run against a fake MCP backend (a real Streamable HTTP server built on
the MCP SDK with canned envelopes), covering normalization, capabilities, the
ledger, edit transactions, and both rollback policies.
