import { emptyArtifactSummary } from "../src/builtin/facts";
import { builtinTaskCardSchema, type BuiltinTaskCard } from "../src/builtin/task-card";
import { deriveTaskProjection } from "../src/builtin/task-projection";

/** A task card with the workflow projection of its fields. Explicit actions or role states win. */
export const createTaskCardFixture = (
  overrides: Partial<BuiltinTaskCard> = {},
): BuiltinTaskCard => {
  const fields = {
    id: "task-1",
    title: "Task 1",
    issueType: "task" as const,
    status: "open" as const,
    updatedAt: "2026-02-22T12:00:00.000Z",
    createdAt: "2026-02-22T12:00:00.000Z",
    artifactSummary: emptyArtifactSummary(),
    ...overrides,
  };
  return builtinTaskCardSchema.parse({ ...deriveTaskProjection(fields), ...fields });
};
