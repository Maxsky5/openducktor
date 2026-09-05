import type {
  AgentSessionControlStopInput,
  AgentSessionControlSummary,
  AgentSessionRecord,
  AgentSessionWorkflowScope,
  AgentTranscriptModelSelection,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { TaskService } from "../tasks/task-service";

type WorkflowSessionStore = Pick<TaskService, "agentSessionUpsert">;

export const toControlSessionRef = (
  repoPath: string,
  summary: AgentSessionControlSummary,
): AgentSessionControlStopInput => ({
  repoPath,
  runtimeKind: summary.runtimeKind,
  workingDirectory: summary.workingDirectory,
  externalSessionId: summary.externalSessionId,
});

export const storeWorkflowSession = (
  tasks: WorkflowSessionStore,
  input: {
    repoPath: string;
    sessionScope: AgentSessionWorkflowScope;
    model: AgentTranscriptModelSelection | undefined;
    selectedModel: AgentSessionRecord["selectedModel"] | undefined;
    summary: AgentSessionControlSummary;
  },
) =>
  tasks
    .agentSessionUpsert({
      repoPath: input.repoPath,
      taskId: input.sessionScope.taskId,
      session: {
        externalSessionId: input.summary.externalSessionId,
        role: input.sessionScope.role,
        startedAt: input.summary.startedAt,
        runtimeKind: input.summary.runtimeKind,
        workingDirectory: input.summary.workingDirectory,
        selectedModel: input.model
          ? { ...input.model, runtimeKind: input.summary.runtimeKind }
          : (input.selectedModel ?? null),
      },
    })
    .pipe(
      Effect.asVoid,
      Effect.mapError((cause) =>
        toHostOperationError(cause, "task-workflow-session.create", {
          repoPath: input.repoPath,
          taskId: input.sessionScope.taskId,
        }),
      ),
    );
