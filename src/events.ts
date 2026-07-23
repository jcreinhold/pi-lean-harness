/**
 * Event bus for pi-lean-harness.
 *
 * The main extension (extensions/lean-harness) owns config loading, settings,
 * and feature discovery. Sub-extensions (extensions/lean-tools) register
 * themselves through these events. No Pi API imports allowed here.
 */

import type { ResolvedLeanHarnessConfig } from "./config/types";

export type LeanFeatureId = "lean-tools";

export const LEAN_FEATURE_REQUEST_EVENT =
  "lean-harness:feature:request" as const;
export const LEAN_FEATURE_REGISTER_EVENT =
  "lean-harness:feature:register" as const;
export const LEAN_CONFIG_UPDATED_EVENT = "lean-harness:config:updated" as const;

export interface LeanFeatureRequestPayload {
  source: "lean-harness";
  timestamp: string;
}

export interface LeanFeatureRegisterPayload {
  source: "lean-harness";
  timestamp: string;
  feature: { id: LeanFeatureId };
}

export interface LeanConfigUpdatedPayload {
  source: "lean-harness";
  timestamp: string;
  config: ResolvedLeanHarnessConfig;
}

function timestamp(): string {
  return new Date().toISOString();
}

export function createFeatureRequestPayload(): LeanFeatureRequestPayload {
  return { source: "lean-harness", timestamp: timestamp() };
}

export function createFeatureRegisterPayload(
  feature: LeanFeatureId,
): LeanFeatureRegisterPayload {
  return {
    source: "lean-harness",
    timestamp: timestamp(),
    feature: { id: feature },
  };
}

export function createConfigUpdatedPayload(
  config: ResolvedLeanHarnessConfig,
): LeanConfigUpdatedPayload {
  return { source: "lean-harness", timestamp: timestamp(), config };
}
