/**
 * Regression test: after a lean-host-mcp restart, the server's HTTP 404 for
 * the stale `Mcp-Session-Id` must trigger a fresh initialize and one retry
 * (MCP Streamable HTTP spec; the SDK transport does not do this itself —
 * modelcontextprotocol/typescript-sdk#1708).
 */

import { describe, expect, it } from "vitest";
import { LeanBackendClient } from "../src/backend/mcp-client";
import { ok, PROJECT_STATUS, startFakeBackend } from "./fake-backend";

describe("LeanBackendClient stale-session recovery", () => {
  it("reconnects and retries when the server forgets the MCP session", async () => {
    const backend = await startFakeBackend({
      handlers: {
        lean_status: () => ok(PROJECT_STATUS),
      },
    });
    const client = new LeanBackendClient({
      url: backend.url,
      requestTimeoutMs: 10_000,
    });
    try {
      const first = await client.projectStatus();
      expect(first).toEqual(ok(PROJECT_STATUS));
      expect(backend.calls).toHaveLength(1);

      // Simulate a lean-host-mcp restart: the server forgets every session.
      backend.dropSessions();

      const second = await client.projectStatus();
      expect(second).toEqual(ok(PROJECT_STATUS));
      expect(backend.calls).toHaveLength(2);
    } finally {
      await client.close().catch(() => undefined);
      await backend.close();
    }
  });

  it("does not reconnect for non-session failures", async () => {
    const backend = await startFakeBackend({
      handlers: {
        lean_status: () => {
          throw new Error("handler exploded");
        },
      },
    });
    const client = new LeanBackendClient({
      url: backend.url,
      requestTimeoutMs: 10_000,
    });
    try {
      await expect(client.projectStatus()).rejects.toThrow(
        /lean_status failed|handler exploded|Internal error/i,
      );
      expect(backend.calls).toHaveLength(1);
    } finally {
      await client.close().catch(() => undefined);
      await backend.close();
    }
  });
});
