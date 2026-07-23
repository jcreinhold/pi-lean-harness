/**
 * Capability check: run once when the harness first connects to a
 * lean-host-mcp server. Fails clearly when the backend is missing tools the
 * facade depends on, instead of silently degrading.
 */

import { type LeanBackendClient, LeanBackendError } from "./mcp-client";

/** Backend tools the facade composes. All five must be present. */
export const REQUIRED_TOOLS = [
  "lean_context",
  "lean_trial",
  "lean_verify",
  "lean_lookup",
  "lean_status",
] as const;

export interface CapabilitiesReport {
  /** All tool names advertised by the server. */
  tools: string[];
  /** Lake project root reported by the server. */
  projectRoot?: string;
  /** Lean toolchain reported by the server. */
  toolchain?: string;
}

/**
 * Verify the connected server exposes every required tool, then probe
 * `lean_status` (kind = "project") for the project root and toolchain.
 *
 * Throws LeanBackendError (not retryable) when tools are missing: that means
 * the server version is incompatible and no retry will fix it.
 */
export async function checkCapabilities(
  client: LeanBackendClient,
): Promise<CapabilitiesReport> {
  const tools = await client.listToolNames();
  const missing = REQUIRED_TOOLS.filter(
    (required) => !tools.includes(required),
  );
  if (missing.length > 0) {
    throw new LeanBackendError(
      `lean-host-mcp server is missing required tools: ${missing.join(", ")}. ` +
        `Advertised tools: ${tools.join(", ") || "(none)"}. ` +
        "Upgrade lean-host-mcp to a version exposing the five semantic tools.",
    );
  }

  const report: CapabilitiesReport = { tools };
  try {
    const status = await client.projectStatus();
    const data = status.data;
    if (data) {
      if (typeof data.project_root === "string")
        report.projectRoot = data.project_root;
      if (typeof data.lean_toolchain === "string")
        report.toolchain = data.lean_toolchain;
    }
  } catch {
    // Status probing is best-effort; the tool check above is the hard gate.
  }
  return report;
}
