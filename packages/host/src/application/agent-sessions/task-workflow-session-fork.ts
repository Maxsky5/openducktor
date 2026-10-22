import type {
  AgentWorkflowSessionForkInput,
  AgentWorkflowSessionForkResult,
} from "@openducktor/contracts";
import { Effect, Exit } from "effect";
import { causeMessage, type HostError } from "../../effect/host-errors";
import type { RuntimeAdmissionPort } from "../../ports/runtime-admission-port";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import type { createAgentSessionCommandService } from "./agent-session-command-service";
import type { TaskSessionOperations } from "./task-session-operations";
import { workflowSessionRecord } from "./task-workflow-session-storage";

export const createTaskWorkflowSessionFork =
  (deps: {
    runtimeAdmission: RuntimeAdmissionPort;
    commands: Pick<ReturnType<typeof createAgentSessionCommandService>, "runWorkflowForkOperation">;
    sessions: Pick<TaskSessionOperations, "fork">;
    stop: AgentSessionLiveStateService["stopSession"];
  }) =>
  (
    input: AgentWorkflowSessionForkInput,
  ): Effect.Effect<AgentWorkflowSessionForkResult, HostError> =>
    deps.runtimeAdmission.admit(
      input.runtimeKind,
      deps.commands.runWorkflowForkOperation(input, (prepared) =>
        Effect.gen(function* () {
          const { session, publish } = yield* deps.sessions.fork(prepared, {
            checkCanceled: () => Effect.void,
            created: () => Effect.void,
            saved: () => {},
            stop: deps.stop,
          });
          const record = workflowSessionRecord({
            repoPath: prepared.repoPath,
            sessionScope: input.sessionScope,
            model: prepared.model,
            selectedModel: undefined,
            summary: session,
          }).session;
          const published = yield* Effect.exit(publish);
          const result: AgentWorkflowSessionForkResult = { record, runtimeSession: session };
          if (Exit.isFailure(published))
            result.syncWarning = `The fork was saved, but session updates could not sync: ${causeMessage(published.cause)}. Reconnect to refresh sessions.`;
          return result;
        }),
      ),
    );
