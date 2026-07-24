import type { ProofPositionSelector } from "../backend/types";
import type { LeanSessionState, ProofFocus } from "./types";

export interface FocusOverride {
  file?: string;
  declaration?: string;
  proofPosition?: ProofPositionSelector;
}

export class FocusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FocusError";
  }
}

/**
 * Resolve the effective focus for a tool call. Explicit arguments win and
 * update the focus; omitted arguments fall back to the current focus.
 * Throws FocusError when no focus can be resolved.
 */
export function resolveFocus(
  state: LeanSessionState,
  override: FocusOverride,
): ProofFocus {
  const file = override.file ?? state.focus?.file;
  const declaration = override.declaration ?? state.focus?.declaration;
  if (!file || !declaration) {
    throw new FocusError(
      "No proof focus is set. Provide both `file` and `declaration` " +
        "(e.g. via lean_state) to focus a proof before using this tool.",
    );
  }
  return {
    file,
    declaration,
    // Do NOT inherit a stored proofPosition: a position set on one call
    // (e.g. {kind:"index", index:2}) must not silently leak into later
    // calls that omit proofPosition, which ran tactics at a stale boundary
    // and produced confusing "No goals to be solved" verdicts. Each call
    // targets the pristine entry goal unless it says otherwise.
    proofPosition: override.proofPosition ?? { kind: "default" },
  };
}

/** True when an override changes the focused file or declaration. */
export function focusChanged(
  state: LeanSessionState,
  override: FocusOverride,
): boolean {
  if (!state.focus) return true;
  if (override.file && override.file !== state.focus.file) return true;
  if (override.declaration && override.declaration !== state.focus.declaration)
    return true;
  return false;
}
