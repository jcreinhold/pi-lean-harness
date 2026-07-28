/**
 * Fake lean-host-mcp server for tests: a real MCP Streamable HTTP endpoint
 * (via the official SDK) whose tool handlers return canned semantic
 * envelopes. Exercises the actual client transport path.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
// biome-ignore lint/plugin: the MCP SDK requires .js suffixes on its ESM subpath imports
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// biome-ignore lint/plugin: the MCP SDK requires .js suffixes on its ESM subpath imports
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// biome-ignore lint/plugin: the MCP SDK requires .js suffixes on its ESM subpath imports
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { SemanticEnvelope } from "../src/backend/types";

export type ToolHandler = (args: Record<string, unknown>) => SemanticEnvelope;

export interface FakeBackend {
  url: string;
  /** Recorded calls, in order. */
  calls: Array<{ name: string; args: Record<string, unknown> }>;
  close: () => Promise<void>;
}

export interface FakeBackendOptions {
  /** Tool handlers by tool name. Missing tools are not advertised. */
  handlers: Record<string, ToolHandler>;
}

export async function startFakeBackend(
  options: FakeBackendOptions,
): Promise<FakeBackend> {
  const calls: FakeBackend["calls"] = [];
  const server = new McpServer({
    name: "fake-lean-host-mcp",
    version: "0.0.0",
  });

  for (const [name, handler] of Object.entries(options.handlers)) {
    server.registerTool(name, { description: `fake ${name}` }, (args) => {
      calls.push({ name, args: args as Record<string, unknown> });
      const envelope = handler(args as Record<string, unknown>);
      return { content: [{ type: "text", text: JSON.stringify(envelope) }] };
    });
  }

  const transports = new Map<string, StreamableHTTPServerTransport>();
  const httpServer: Server = createServer((req, res) => {
    void (async () => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)?.handleRequest(req, res);
        return;
      }
      const body = await readBody(req);
      if (!sessionId && isInitializeRequest(JSON.parse(body))) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id): void => {
            transports.set(id, transport);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) transports.delete(transport.sessionId);
        };
        await server.connect(transport);
        await transport.handleRequest(req, res, JSON.parse(body));
        return;
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad request: no valid session" }));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", resolve),
  );
  const port = (httpServer.address() as AddressInfo).port;

  // Track sockets so close() can sever keep-alive HTTP/SSE connections
  // immediately instead of waiting for them to drain.
  const sockets = new Set<Socket>();
  httpServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    close: () =>
      new Promise((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

/** Envelope factory: data plus an empty issue list and minimal trust. */
export function ok<T>(data: T): SemanticEnvelope<T> {
  return {
    data,
    errors: [],
    trust: {
      project_root: "/fake/project",
      session_id: "fake-session",
      lean_toolchain: "leanprover/lean4:v4.30.0",
      artifacts: [],
    },
  };
}

export function infraError(
  message: string,
  retryable = true,
): SemanticEnvelope {
  return {
    data: null,
    errors: [
      { code: "worker_pressure", message, severity: "error", retryable },
    ],
    trust: {
      project_root: "/fake/project",
      session_id: "s",
      lean_toolchain: "t",
    },
  };
}

export const PROOF_CONTEXT = {
  status: "context",
  declaration_name: "Fake.step",
  namespace_name: "Fake",
  goals_before: ["⊢ True"],
  goals_after: [],
  locals: [],
  truncated: false,
  proof_boundaries: [
    {
      index: 0,
      kind: "entry",
      selector: { kind: "default" },
      source: { start_line: 2, start_column: 3, end_line: 2, end_column: 10 },
      excerpt: { value: "sorry", truncated: false },
    },
  ],
  diagnostics: {
    summary: { errors: 0, warnings: 0, info: 0 },
    diagnostics: [],
    truncated: false,
  },
};

export const PROJECT_STATUS = {
  kind: "project",
  project_root: "/fake/project",
  lean_toolchain: "leanprover/lean4:v4.30.0",
  include: [],
  worker_opened: false,
  broker: { lean_max_memory_kib: 18874368 },
  output: { response_carrier: "content", telemetry_verbosity: "compact" },
};
