/**
 * Shared harness context: one MCP client, one proof-session state, one
 * capabilities report. All five façade tools operate on this object so they
 * share focus, fingerprints, and the proof ledger.
 */

import { isAbsolute, join } from "node:path";
import {
  type CapabilitiesReport,
  checkCapabilities,
  LeanBackendClient,
} from "../backend";
import type { ResolvedLeanHarnessConfig } from "../config/types";
import {
  createEmptyState,
  type LeanSessionState,
  setBackendIdentity,
} from "../proof-state";

export class LeanHarness {
  client: LeanBackendClient;
  readonly state: LeanSessionState;
  private capabilities: CapabilitiesReport | null = null;

  constructor(
    private config: ResolvedLeanHarnessConfig,
    state?: LeanSessionState,
  ) {
    this.client = new LeanBackendClient(config.server);
    this.state = state ?? createEmptyState();
  }

  getConfig(): ResolvedLeanHarnessConfig {
    return this.config;
  }

  /** Replace the config; recreates the client when server settings changed. */
  setConfig(config: ResolvedLeanHarnessConfig): void {
    const serverChanged =
      config.server.url !== this.config.server.url ||
      config.server.requestTimeoutMs !== this.config.server.requestTimeoutMs ||
      config.server.project !== this.config.server.project;
    this.config = config;
    if (serverChanged) {
      void this.client.close().catch(() => undefined);
      this.client = new LeanBackendClient(config.server);
      this.capabilities = null;
    }
  }

  /**
   * Connect (lazily) and run the capability check once. Every tool calls this
   * first; failures surface as clear LeanBackendError messages.
   */
  async ensureReady(): Promise<CapabilitiesReport> {
    await this.client.connect();
    if (!this.capabilities) {
      this.capabilities = await checkCapabilities(this.client);
      setBackendIdentity(this.state, {
        projectRoot: this.capabilities.projectRoot,
        toolchain: this.capabilities.toolchain,
      });
    }
    return this.capabilities;
  }

  /** Project root reported by the server; requires ensureReady() first. */
  projectRoot(): string {
    const root = this.capabilities?.projectRoot ?? this.state.projectRoot;
    if (!root) {
      throw new Error(
        "The lean-host-mcp server did not report a project root. " +
          "Start it inside a Lake project or pass --lake-root.",
      );
    }
    return root;
  }

  /** Resolve a project-relative .lean path to an absolute filesystem path. */
  resolveProjectPath(file: string): string {
    return isAbsolute(file) ? file : join(this.projectRoot(), file);
  }
}
