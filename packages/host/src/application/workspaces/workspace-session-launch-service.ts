import type {
  AgentSessionControlResumeInput,
  AgentSessionControlSendInput,
  AgentSessionControlSummary,
  WorkspaceSessionLaunchRequest,
  WorkspaceSessionLaunchResult,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { createSessionLaunchService } from "../agent-sessions/session-launch-service";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import { createWorkspaceSessionRecordReader } from "./workspace-session-record-reader";
import {
  createWorkspaceSessionStart,
  type WorkspaceSessionStartDependencies,
} from "./workspace-session-start";
import type { resolveSessionMessageParts } from "../attachments/resolve-session-message-parts";
import type { WorkspaceSessionUpdatedPublisher } from "./workspace-session-persistence-callbacks";

export type WorkspaceSessionLaunchDependencies = WorkspaceSessionStartDependencies & {
  resolveParts: (
    parts: Parameters<typeof resolveSessionMessageParts>[0],
  ) => ReturnType<typeof resolveSessionMessageParts>;
  commands: Pick<AgentSessionLiveStateService, "sendUserMessage" | "resumeSession">;
  live: Pick<
    AgentSessionLiveStateService,
    "read" | "holdWorkflowLaunch" | "stopSession" | "reportLaunchFailure"
  >;
  publishUpdated: WorkspaceSessionUpdatedPublisher;
};

/** Binds a workspace chat to a runtime session and sends its first instruction. */
export const createWorkspaceSessionLaunchService = (deps: WorkspaceSessionLaunchDependencies) => {
  const { scopeFor, recordFor } = createWorkspaceSessionRecordReader(deps);
  return createSessionLaunchService<WorkspaceSessionLaunchRequest, WorkspaceSessionLaunchResult>({
    runtime: deps.live,
    send: (_request, input, options) => deps.commands.sendUserMessage(input, options),
    initial: (request) =>
      Effect.succeed({
        workspaceId: request.workspaceId,
        repoPath: request.repoPath,
        sessionId: request.sessionId,
        status: "completed" as const,
      }),
    key: (request) => JSON.stringify([request.workspaceId, request.sessionId]),
    run: (attempt) =>
      Effect.gen(function* () {
        const request = attempt.request;
        const scope = yield* scopeFor(request.workspaceId);
        if (
          normalizePathForComparison(scope.repoPath) !==
          normalizePathForComparison(request.repoPath)
        )
          return yield* invalid("Workspace and repository do not match.");
        yield* attempt.checkCanceled();
        const parts = yield* deps.resolveParts(request.parts);
        const start = createWorkspaceSessionStart(
          deps,
          (summary) =>
            Effect.gen(function* () {
              yield* attempt.checkCanceled();
              yield* attempt.createdSession(scope.repoPath, summary, { hold: true });
            }),
          { assertCurrent: attempt.assertCurrent },
        );
        yield* attempt.checkCanceled();
        const started = yield* start(request);
        const record = started.session;
        if (!record.externalSessionId)
          return yield* invalid("The host did not save a runtime session identity.");
        attempt.setResultFields({ record });
        if (record.selectedModel) attempt.setResultFields({ model: record.selectedModel });
        const ref = {
          repoPath: scope.repoPath,
          runtimeKind: record.runtimeKind,
          workingDirectory: record.executionTarget.workingDirectory,
          externalSessionId: record.externalSessionId,
        };
        const sessionScope = { kind: "repository" as const };
        if (started.runtimeSession) attempt.ownershipSaved();
        else {
          const live = yield* deps.live.read(ref);
          let session: AgentSessionControlSummary;
          if (live.type === "live")
            session = {
              runtimeKind: ref.runtimeKind,
              workingDirectory: ref.workingDirectory,
              externalSessionId: ref.externalSessionId,
              startedAt: live.session.startedAt,
              status: "idle",
            };
          else {
            const resume: AgentSessionControlResumeInput &
              import("@openducktor/core").AgentWorkStartOptions = {
              ...ref,
              workStartGuard: { assertCurrent: attempt.assertCurrent },
              sessionScope,
              resumeMode: "reattach",
            };
            if (record.selectedModel) resume.model = record.selectedModel;
            session = yield* deps.commands.resumeSession(resume);
          }
          attempt.reusedSession(scope.repoPath, session);
        }
        yield* deps.publishUpdated(request.workspaceId, record);
        const input: AgentSessionControlSendInput = {
          ...ref,
          sessionScope,
          parts,
          delivery: "new_turn",
        };
        yield* attempt.send(input, request.parts);
        attempt.setResultFields({ record: (yield* recordFor(request)).session });
      }),
  });
};

export type WorkspaceSessionLaunchService = ReturnType<typeof createWorkspaceSessionLaunchService>;
const invalid = (message: string) =>
  new HostValidationError({ field: "workspaceSessionLaunch", message });
