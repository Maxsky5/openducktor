import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkflowLibraryService } from "../../application/workflow-library/workflow-library-service";
import { createWorkflowLibraryCommandHandlers } from "./workflow-library-command-handlers";

const handlersWith = (service: Partial<WorkflowLibraryService>) =>
  // SAFETY: every service member exists; the members that a test does not name fail when called.
  createWorkflowLibraryCommandHandlers({
    ...Object.fromEntries(
      [
        "library",
        "document",
        "versions",
        "taskMoves",
        "roleImpact",
        "exportWorkflow",
        "importPreview",
        "create",
        "duplicate",
        "saveDraft",
        "discardDraft",
        "publish",
        "moveTasks",
        "deleteWorkflow",
        "importCommit",
        "saveRole",
        "deleteRole",
        "setWorkspaceWorkflows",
      ].map((name) => [name, () => Effect.die(`${name} was not expected`)]),
    ),
    ...service,
  } as WorkflowLibraryService);

describe("workflow library command handlers", () => {
  test("passes the parsed input to the service", async () => {
    const received: unknown[] = [];
    const handlers = handlersWith({
      create: (input) => Effect.sync(() => (received.push(input), { workflowId: "flow" })),
    });

    expect(await Effect.runPromise(handlers.workflow_create({ name: "  Flow " }))).toEqual({
      workflowId: "flow",
    });
    expect(received).toEqual([{ name: "Flow" }]);
  });

  test("rejects input that does not match the command schema", async () => {
    const result = await Effect.runPromise(
      Effect.result(handlersWith({}).workflow_publish({ workflowId: "flow" })),
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("HostValidationError");
      expect(result.failure.message).toStartWith("workflow_publish input is invalid:");
    }
  });
});
