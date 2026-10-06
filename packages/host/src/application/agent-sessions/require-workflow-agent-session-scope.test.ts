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
        Effect.result,
      ),
    );
    const missingResult = await Effect.runPromise(
      requireWorkflowAgentSessionScope(undefined, "resolve runtime policy").pipe(Effect.result),
    );

    expect(repositoryResult._tag).toBe("Failure");
    expect(missingResult._tag).toBe("Failure");
    if (repositoryResult._tag === "Success" || missingResult._tag === "Success") {
      throw new Error("Expected workflow scope validation to fail.");
    }
    expect(repositoryResult.failure).toBeInstanceOf(HostValidationError);
    expect(repositoryResult.failure).toMatchObject({
      field: "sessionScope",
      message:
        "Cannot resolve runtime policy with repository session context; workflow session context is required.",
    });
    expect(missingResult.failure).toBeInstanceOf(HostValidationError);
    expect(missingResult.failure).toMatchObject({
      field: "sessionScope",
      message: "Cannot resolve runtime policy without workflow session context.",
    });
  });
});
