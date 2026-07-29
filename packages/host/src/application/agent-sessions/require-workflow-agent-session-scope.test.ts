import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import { requireWorkflowAgentSessionScope } from "./require-workflow-agent-session-scope";

describe("requireWorkflowAgentSessionScope", () => {
  test("returns workflow scope through the success channel", async () => {
    const scope = { kind: "workflow", taskId: "task-1", role: "build" } as const;

    await expect(
      Effect.runPromise(requireWorkflowAgentSessionScope(scope, "resolve runtime policy")),
    ).resolves.toBe(scope);
  });

  test("returns actionable validation failures through the Effect error channel", async () => {
    const repositoryResult = await Effect.runPromise(
      requireWorkflowAgentSessionScope({ kind: "repository" }, "resolve runtime policy").pipe(
        Effect.either,
      ),
    );
    const missingResult = await Effect.runPromise(
      requireWorkflowAgentSessionScope(undefined, "resolve runtime policy").pipe(Effect.either),
    );

    expect(repositoryResult._tag).toBe("Left");
    expect(missingResult._tag).toBe("Left");
    if (repositoryResult._tag === "Right" || missingResult._tag === "Right") {
      throw new Error("Expected workflow scope validation to fail.");
    }
    expect(repositoryResult.left).toBeInstanceOf(HostValidationError);
    expect(repositoryResult.left).toMatchObject({
      field: "sessionScope",
      message:
        "Cannot resolve runtime policy with repository session context; workflow session context is required.",
    });
    expect(missingResult.left).toBeInstanceOf(HostValidationError);
    expect(missingResult.left).toMatchObject({
      field: "sessionScope",
      message: "Cannot resolve runtime policy without workflow session context.",
    });
  });
});
