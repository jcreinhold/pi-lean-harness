import { describe, expect, it } from "vitest";
import { LeanBackendError } from "../src/backend/mcp-client";
import {
  formatWarnings,
  freshnessSummary,
  requireData,
} from "../src/backend/normalize";
import type { SemanticEnvelope, SemanticTrust } from "../src/backend/types";

function envelope<T>(
  partial: Partial<SemanticEnvelope<T>>,
): SemanticEnvelope<T> {
  return { data: null, errors: [], ...partial };
}

describe("requireData", () => {
  it("returns data and warnings for a clean envelope", () => {
    const result = requireData(
      envelope({
        data: { value: 1 },
        errors: [{ code: "warn", message: "heads up", severity: "warning" }],
      }),
      "tool",
    );
    expect(result.data).toEqual({ value: 1 });
    expect(result.warnings).toHaveLength(1);
  });

  it("throws on infrastructure errors, preserving retryability", () => {
    const call = () =>
      requireData(
        envelope({
          errors: [
            {
              code: "worker_pressure",
              message: "admission full",
              severity: "error",
              retryable: true,
            },
          ],
        }),
        "lean_trial",
      );
    expect(call).toThrow(LeanBackendError);
    try {
      call();
    } catch (error) {
      expect((error as LeanBackendError).retryable).toBe(true);
      expect((error as LeanBackendError).message).toContain("lean_trial");
    }
  });

  it("throws when data is missing", () => {
    expect(() => requireData(envelope({}), "lean_context")).toThrow(/no data/);
  });
});

describe("freshnessSummary", () => {
  const trust = (artifacts: SemanticTrust["artifacts"]): SemanticTrust => ({
    project_root: "/p",
    session_id: "s",
    lean_toolchain: "t",
    artifacts,
  });

  it("reports current for fresh artifacts", () => {
    expect(
      freshnessSummary(
        trust([{ artifact: "source", scope: "file", status: "edit_fresh" }]),
      ),
    ).toBe("current");
  });

  it("reports stale artifacts", () => {
    const summary = freshnessSummary(
      trust([
        {
          artifact: "olean",
          scope: "module",
          status: "missing_build",
          module: "Foo",
        },
      ]),
    );
    expect(summary).toContain("stale");
    expect(summary).toContain("olean");
  });
});

describe("formatWarnings", () => {
  it("renders bullets with next actions", () => {
    const text = formatWarnings([
      {
        code: "w",
        message: "slow",
        severity: "warning",
        next_action: "retry smaller",
      },
    ]);
    expect(text).toContain("- slow");
    expect(text).toContain("retry smaller");
  });
});
