/**
 * MCP client for lean-host-mcp over Streamable HTTP.
 *
 * The harness only ever talks to an already-running server (HTTP transport).
 * It never spawns a stdio server, which keeps memory footprint flat when many
 * Pi sessions run in parallel against one shared lean-host-mcp process.
 */

// biome-ignore lint/plugin: the MCP SDK requires .js suffixes on its ESM subpath imports
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// biome-ignore lint/plugin: the MCP SDK requires .js suffixes on its ESM subpath imports
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  ProofContextData,
  ProofPositionSelector,
  ProofStepTrialData,
  SemanticEnvelope,
  VerifyData,
  VerifyTarget,
} from "./types";

export class LeanBackendError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    options?: { retryable?: boolean; cause?: unknown },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "LeanBackendError";
    this.retryable = options?.retryable ?? false;
  }
}

export interface LeanBackendOptions {
  /** Streamable HTTP endpoint, e.g. http://127.0.0.1:8765/mcp */
  url: string;
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs: number;
  /** Optional Lake project-root override forwarded to the server. */
  project?: string;
}

interface RawCallResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export class LeanBackendClient {
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;

  constructor(private readonly options: LeanBackendOptions) {}

  /** Connect to the server. Idempotent; concurrent callers share one attempt. */
  async connect(): Promise<void> {
    if (this.client) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const client = new Client(
        { name: "pi-lean-harness", version: "0.1.0" },
        { capabilities: {} },
      );
      const transport = new StreamableHTTPClientTransport(
        new URL(this.options.url),
      );
      try {
        await client.connect(transport);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new LeanBackendError(
          `Cannot reach lean-host-mcp at ${this.options.url}: ${detail}\n` +
            "Start a server with: lean-host-mcp serve --bind 127.0.0.1:8765",
          { retryable: true },
        );
      }
      this.client = client;
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) {
      await client.close().catch(() => undefined);
    }
  }

  get connected(): boolean {
    return this.client !== null;
  }

  /** Names of all tools the connected server advertises. */
  async listToolNames(): Promise<string[]> {
    const client = await this.requireClient();
    const result = await client.listTools();
    return result.tools.map((tool) => tool.name);
  }

  /**
   * Call a raw server tool and return the parsed semantic envelope.
   * Prefers `structuredContent`; falls back to JSON in text content (the
   * server's default response carrier).
   */
  async callTool<T = unknown>(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<SemanticEnvelope<T>> {
    const client = await this.requireClient();
    let raw: RawCallResult;
    try {
      raw = (await client.callTool({ name, arguments: args }, undefined, {
        timeout: this.options.requestTimeoutMs,
        signal,
      })) as RawCallResult;
    } catch (error) {
      if (error instanceof LeanBackendError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new LeanBackendError(
        `lean-host-mcp call ${name} failed: ${detail}`,
        {
          retryable: true,
        },
      );
    }
    return parseEnvelope<T>(raw, name);
  }

  // --- Typed wrappers for the five backend tools -------------------------

  async proofContext(
    args: {
      file: string;
      declaration: string;
      proofPosition?: ProofPositionSelector;
    },
    signal?: AbortSignal,
  ): Promise<SemanticEnvelope<ProofContextData>> {
    return this.callTool<ProofContextData>(
      "lean_context",
      this.withProject({
        kind: "proof_position",
        file: args.file,
        declaration: args.declaration,
        proof_position: args.proofPosition ?? { kind: "default" },
      }),
      signal,
    );
  }

  async trialProofStep(
    args: {
      file: string;
      declaration: string;
      snippets: string[];
      proofPosition?: ProofPositionSelector;
    },
    signal?: AbortSignal,
  ): Promise<SemanticEnvelope<ProofStepTrialData>> {
    return this.callTool<ProofStepTrialData>(
      "lean_trial",
      this.withProject({
        kind: "proof_step",
        file: args.file,
        declaration: args.declaration,
        snippets: args.snippets,
        proof_position: args.proofPosition ?? { kind: "default" },
      }),
      signal,
    );
  }

  async verify(
    args: {
      targets: VerifyTarget[];
      allowSorry?: boolean;
      reportAxioms?: boolean;
      detail?: "compact" | "full";
    },
    signal?: AbortSignal,
  ): Promise<SemanticEnvelope<VerifyData>> {
    return this.callTool<VerifyData>(
      "lean_verify",
      this.withProject({
        targets: args.targets,
        allow_sorry: args.allowSorry ?? false,
        report_axioms: args.reportAxioms ?? false,
        detail: args.detail ?? "compact",
      }),
      signal,
    );
  }

  /** Generic lean_lookup call; `args` includes the `kind` mode field. */
  async lookup(
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<SemanticEnvelope<Record<string, unknown>>> {
    return this.callTool<Record<string, unknown>>(
      "lean_lookup",
      this.withProject(args),
      signal,
    );
  }

  async fileDiagnostics(
    file: string,
    signal?: AbortSignal,
  ): Promise<SemanticEnvelope<Record<string, unknown>>> {
    return this.callTool<Record<string, unknown>>(
      "lean_status",
      this.withProject({ kind: "file_diagnostics", file }),
      signal,
    );
  }

  async projectStatus(
    signal?: AbortSignal,
  ): Promise<SemanticEnvelope<Record<string, unknown>>> {
    return this.callTool<Record<string, unknown>>(
      "lean_status",
      this.withProject({ kind: "project" }),
      signal,
    );
  }

  private withProject(args: Record<string, unknown>): Record<string, unknown> {
    if (this.options.project && args.project === undefined) {
      return { ...args, project: this.options.project };
    }
    return args;
  }

  private async requireClient(): Promise<Client> {
    await this.connect();
    if (!this.client) {
      throw new LeanBackendError("lean-host-mcp client is not connected", {
        retryable: true,
      });
    }
    return this.client;
  }
}

function parseEnvelope<T>(
  raw: RawCallResult,
  toolName: string,
): SemanticEnvelope<T> {
  if (raw.structuredContent !== undefined && raw.structuredContent !== null) {
    return raw.structuredContent as SemanticEnvelope<T>;
  }
  const text = (raw.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  if (!text) {
    if (raw.isError) {
      throw new LeanBackendError(
        `lean-host-mcp tool ${toolName} returned an empty error result`,
      );
    }
    throw new LeanBackendError(
      `lean-host-mcp tool ${toolName} returned no parseable content`,
    );
  }
  try {
    return JSON.parse(text) as SemanticEnvelope<T>;
  } catch {
    if (raw.isError) {
      throw new LeanBackendError(
        `lean-host-mcp tool ${toolName} failed: ${text}`,
      );
    }
    throw new LeanBackendError(
      `lean-host-mcp tool ${toolName} returned non-JSON content; set ` +
        "LEAN_HOST_MCP_RESPONSE_CARRIER=structured or both on the server",
    );
  }
}
