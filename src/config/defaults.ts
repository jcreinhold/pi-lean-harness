import type { ResolvedLeanHarnessConfig } from "./types";

export const DEFAULT_CONFIG: ResolvedLeanHarnessConfig = {
  server: {
    url: "http://127.0.0.1:8765/mcp",
    requestTimeoutMs: 30_000,
  },
  apply: {
    onVerifyFailure: "rollback",
  },
  tools: {
    enabled: true,
  },
  exposeRawBackendTools: false,
};
