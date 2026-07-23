/**
 * Configuration types for pi-lean-harness.
 *
 * Raw config (`LeanHarnessConfig`) is the user-facing shape: every field is
 * optional. `ResolvedLeanHarnessConfig` has defaults merged in.
 */

/** Backend server connection settings. */
export interface LeanServerConfig {
  /**
   * Streamable HTTP endpoint of a running lean-host-mcp server.
   * Start one with: lean-host-mcp serve --bind 127.0.0.1:8765
   */
  url?: string;
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs?: number;
  /**
   * Optional absolute path to the Lake project root. Forwarded to backend
   * operations that accept a project override. When omitted, the server's
   * own --lake-root resolution is used.
   */
  project?: string;
}

/** Settings for the lean_apply transactional edit. */
export interface LeanApplyConfig {
  /**
   * What to do when post-edit verification fails:
   * - "rollback": restore the original file bytes (default).
   * - "keep": leave the edit in place and report it as unverified.
   */
  onVerifyFailure?: "rollback" | "keep";
}

/** Toggle for the lean-tools sub-extension. */
export interface LeanToolsConfig {
  enabled?: boolean;
}

/** User-facing configuration (all fields optional). */
export interface LeanHarnessConfig {
  $schema?: string;
  server?: LeanServerConfig;
  apply?: LeanApplyConfig;
  tools?: LeanToolsConfig;
  /**
   * Reserved. Raw lean-host-mcp tools are never registered by this package;
   * this flag is kept for a future human-debug surface.
   */
  exposeRawBackendTools?: boolean;
}

/** Resolved configuration (defaults merged in, all fields required). */
export interface ResolvedLeanHarnessConfig {
  server: {
    url: string;
    requestTimeoutMs: number;
    project?: string;
  };
  apply: {
    onVerifyFailure: "rollback" | "keep";
  };
  tools: {
    enabled: boolean;
  };
  exposeRawBackendTools: boolean;
}
