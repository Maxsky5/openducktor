import type {
  WorkspaceSessionLaunchRead,
  WorkspaceSessionLaunchRef,
  WorkspaceSessionLaunchRequest,
  WorkspaceSessionLaunchSnapshot,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { toControlSessionRef } from "../agent-sessions/task-workflow-session-storage";
import { createSessionLaunchService } from "../agent-sessions/session-launch-service";
import type {
  SessionLaunchContext,
  SessionLaunchSendInput,
} from "../agent-sessions/session-launch-types";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import { createWorkspaceSessionRecordReader } from "./workspace-session-record-reader";
import { createWorkspaceSessionStart } from "./workspace-session-start";
import type { WorkspaceSessionServiceDependencies } from "./workspace-session-service";
import type { resolveSessionMessageParts } from "../attachments/resolve-session-message-parts";
import type { WorkspaceSessionUpdatedPublisher } from "./workspace-session-persistence-callbacks";

type Attempt = SessionLaunchContext<WorkspaceSessionLaunchRequest, WorkspaceSessionLaunchSnapshot>;
export const createWorkspaceSessionLaunchService = (
  deps: WorkspaceSessionServiceDependencies & {
    resolveParts: (
      parts: Parameters<typeof resolveSessionMessageParts>[0],
    ) => ReturnType<typeof resolveSessionMessageParts>;
    commands: Pick<AgentSessionLiveStateService, "sendUserMessage" | "resumeSession">;
    live: AgentSessionLiveStateService;
    publishUpdated: WorkspaceSessionUpdatedPublisher;
    publish: (
      snapshot: WorkspaceSessionLaunchSnapshot,
    ) => Effect.Effect<void, import("../../effect/host-errors").HostError>;
  },
) => {
  const { scopeFor, recordFor } = createWorkspaceSessionRecordReader(deps);
  const readScope = (input: WorkspaceSessionLaunchRead) =>
    scopeFor(input.workspaceId).pipe(
      Effect.flatMap((scope) =>
        normalizePathForComparison(scope.repoPath) === normalizePathForComparison(input.repoPath)
          ? Effect.succeed(scope)
          : Effect.fail(invalid("Workspace and repository do not match.")),
      ),
      Effect.mapError((cause) => toHostOperationError(cause, "workspace-session-launch.read")),
    );
  const validateOwner = (attempt: Attempt) =>
    Effect.gen(function* () {
      const input = attempt.sendInput!;
      const { session } = yield* recordFor(attempt.request);
      const model = attempt.snapshot.model;
      if (
        session.externalSessionId !== input.externalSessionId ||
        session.runtimeKind !== input.runtimeKind ||
        session.executionTarget.workingDirectory !== input.workingDirectory ||
        session.selectedModel?.providerId !== model?.providerId ||
        session.selectedModel?.modelId !== model?.modelId ||
        session.selectedModel?.variant !== model?.variant ||
        session.selectedModel?.profileId !== model?.profileId
      )
        return yield* invalid(
          "The saved session or model changed after launch. Inspect the chat before retrying.",
        );
    });
  const send = (attempt: Attempt) =>
    Effect.gen(function* () {
      yield* validateOwner(attempt);
      yield* attempt.send(deps.commands.sendUserMessage);
      const saved = yield* recordFor(attempt.request);
      attempt.updateOwner({ record: saved.session });
    });
  const withOwner = (attempt: Attempt, work: Effect.Effect<unknown, unknown>) =>
    deps.operationGate.run(attempt.request, attempt.withSession(work));
  return createSessionLaunchService<
    WorkspaceSessionLaunchRequest,
    WorkspaceSessionLaunchSnapshot,
    WorkspaceSessionLaunchRef,
    WorkspaceSessionLaunchRead
  >({
    runtime: deps.live,
    publish: deps.publish,
    initial: (request) => ({
      snapshot: {
        launchAttemptId: request.launchAttemptId,
        workspaceId: request.workspaceId,
        repoPath: request.repoPath,
        sessionId: request.sessionId,
        phase: "queued",
        acceptance: "not_submitted",
        ownershipSaved: false,
      },
    }),
    key: (request) => `${request.workspaceId}\0${request.sessionId}`,
    queue: () => false,
    matches: (request, ref) =>
      request.workspaceId === ref.workspaceId &&
      request.repoPath === ref.repoPath &&
      request.sessionId === ref.sessionId,
    includes: (request, ref) =>
      request.workspaceId === ref.workspaceId &&
      request.repoPath === ref.repoPath &&
      request.sessionId === ref.sessionId &&
      (!ref.launchAttemptId || request.launchAttemptId === ref.launchAttemptId),
    validateRead: (input) => readScope(input).pipe(Effect.asVoid),
    run: (attempt) =>
      withOwner(
        attempt,
        Effect.gen(function* () {
          const scope = yield* readScope(attempt.request);
          attempt.updateOwner({ repoPath: scope.repoPath });
          yield* attempt.checkCanceled();
          const parts = yield* deps.resolveParts(attempt.request.parts);
          attempt.stage("session");
          yield* attempt.prepare();
          const start = createWorkspaceSessionStart(deps, (summary) =>
            Effect.gen(function* () {
              yield* attempt.checkCanceled();
              yield* deps.live.holdWorkflowLaunch(
                toControlSessionRef(scope.repoPath, summary),
                true,
              );
              yield* attempt.checkCanceled();
              // The start helper releases unbound sessions. Retain only after these checks.
              attempt.retainSession(summary);
            }),
          );
          yield* attempt.checkCanceled();
          const started = yield* start(attempt.request);
          const { session } = started;
          if (!session.externalSessionId)
            return yield* invalid("The host did not save a runtime session identity.");
          attempt.updateOwner({ record: session });
          attempt.ownershipSaved();
          if (session.selectedModel) attempt.updateOwner({ model: session.selectedModel });
          const input: SessionLaunchSendInput = {
            repoPath: scope.repoPath,
            externalSessionId: session.externalSessionId,
            runtimeKind: session.runtimeKind,
            workingDirectory: session.executionTarget.workingDirectory,
            sessionScope: { kind: "repository" },
            speed: session.speed,
            parts,
          };
          if (session.selectedModel) input.model = session.selectedModel;
          attempt.retainInstruction(input);
          if (!attempt.snapshot.session) {
            attempt.retainSession({
              runtimeKind: input.runtimeKind,
              workingDirectory: input.workingDirectory,
              externalSessionId: input.externalSessionId,
              startedAt: new Date(session.createdAt).toISOString(),
              status: "idle",
            });
            const ref = {
              repoPath: input.repoPath,
              runtimeKind: input.runtimeKind,
              workingDirectory: input.workingDirectory,
              externalSessionId: input.externalSessionId,
            };
            const live = yield* deps.live.read(ref);
            if (live.type === "live")
              attempt.retainSession({
                runtimeKind: input.runtimeKind,
                workingDirectory: input.workingDirectory,
                externalSessionId: input.externalSessionId,
                startedAt: live.session.startedAt,
                status: "idle",
              });
            else {
              const resume: Parameters<typeof deps.commands.resumeSession>[0] = {
                ...ref,
                sessionScope: input.sessionScope,
                resumeMode: "reattach",
              };
              if (input.model) resume.model = input.model;
              if (input.speed !== undefined) resume.speed = input.speed;
              attempt.retainSession(yield* deps.commands.resumeSession(resume));
            }
          }
          attempt.stage("publication");
          yield* deps.publishUpdated(attempt.request.workspaceId, session);
          yield* send(attempt);
        }),
      ),
    recover: (attempt) =>
      withOwner(
        attempt,
        Effect.gen(function* () {
          yield* readScope(attempt.request);
          yield* validateOwner(attempt);
          const input = attempt.sendInput!;
          const live = yield* deps.live.read(
            toControlSessionRef(input.repoPath, attempt.snapshot.session!),
          );
          if (live.type === "missing") {
            const resume: Parameters<typeof deps.commands.resumeSession>[0] = {
              ...toControlSessionRef(input.repoPath, attempt.snapshot.session!),
              sessionScope: input.sessionScope,
              resumeMode: "reattach",
            };
            if (input.model) resume.model = input.model;
            if (input.speed !== undefined) resume.speed = input.speed;
            yield* deps.commands.resumeSession(resume);
          }
          yield* send(attempt);
        }),
      ),
  });
};

export type WorkspaceSessionLaunchService = ReturnType<typeof createWorkspaceSessionLaunchService>;
const invalid = (message: string) =>
  new HostValidationError({ field: "workspaceSessionLaunch", message });
