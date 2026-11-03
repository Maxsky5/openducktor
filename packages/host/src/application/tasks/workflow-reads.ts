import { type WorkspaceRef, type WorkspaceWorkflowContext } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";

export const createWorkflowReads = (resolver: TaskWorkflowResolver, hostInstanceId: string) => {
  const read = <A>(work: () => A) =>
    Effect.try({
      try: work,
      catch: (cause) =>
        new HostValidationError({
          field: "workflow",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  return {
    catalog: () => read(() => resolver.catalog(hostInstanceId)),
    workspace: (scope: WorkspaceRef) =>
      read((): WorkspaceWorkflowContext => {
        const workspace = resolver.forWorkspace(scope);
        return {
          hostInstanceId,
          board: workspace.board,
          workflows: workspace.workflows.map(({ reference }) => reference),
          newTaskWorkflow: workspace.newTaskWorkflow.reference,
        };
      }),
  };
};
