import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { requireWorkflowAgentSession } from "./workflow-session";

describe("workflow session narrowing", () => {
  test("returns workflow sessions with task and role data", () => {
    const session = createAgentSessionFixture({
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    });

    expect(requireWorkflowAgentSession(session, "send a message").sessionAssociation).toEqual({
      kind: "workflow",
      taskId: "task-1",
      role: "build",
    });
  });

  test.each(["repository", "unbound"] as const)(
    "reports an actionable failure for a %s session",
    (kind) => {
      const session = createAgentSessionFixture({ sessionAssociation: { kind } });

      expect(() => requireWorkflowAgentSession(session, "send a message")).toThrow(
        `Cannot send a message for session '${session.externalSessionId}' because its association is ${kind}.`,
      );
    },
  );
});
