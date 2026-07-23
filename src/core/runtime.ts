/**
 * Shared runtime handle: the lean-tools sub-extension owns the active
 * LeanHarness; the main extension's /lean-debug command reads it. Kept in
 * src/ so both entry points share one instance.
 */

import type { LeanHarness } from "./harness";

let active: LeanHarness | null = null;

export function setActiveHarness(harness: LeanHarness | null): void {
  active = harness;
}

export function getActiveHarness(): LeanHarness | null {
  return active;
}
