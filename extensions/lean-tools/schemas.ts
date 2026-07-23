/**
 * Shared TypeBox schemas for the lean_* tools.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const proofPositionSchema = Type.Optional(
  Type.Object(
    {
      kind: StringEnum(["default", "index", "after_text"] as const, {
        description:
          '"default" = entry goal before any tactic; "index" = state after the Nth tactic; ' +
          '"after_text" = boundary matching a source fragment.',
      }),
      index: Type.Optional(
        Type.Number({
          description: 'Tactic index when kind is "index" (0-based)',
        }),
      ),
      text: Type.Optional(
        Type.String({
          description: 'Source fragment when kind is "after_text"',
        }),
      ),
      occurrence: Type.Optional(
        Type.Number({
          description: 'Occurrence of the fragment when kind is "after_text"',
        }),
      ),
    },
    { description: "Proof position within the declaration's tactic block" },
  ),
);

export const focusFields = {
  file: Type.Optional(
    Type.String({
      description:
        "Project-relative .lean path (e.g. MyProject/Foo.lean). Sets the focus when provided.",
    }),
  ),
  declaration: Type.Optional(
    Type.String({
      description:
        "Fully-qualified declaration name (e.g. MyProject.foo). Sets the focus when provided.",
    }),
  ),
  proofPosition: proofPositionSchema,
};
