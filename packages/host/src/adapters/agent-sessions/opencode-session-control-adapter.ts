import type { OpencodeSessionRuntimeConnection } from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionControlSummary,
  acceptedAgentUserMessageSchema,
  agentSessionTranscriptEventSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { type HostError, toHostOperationError } from "../../effect/host-errors";
import type {
  AgentSessionControlAdapterPort,
  AgentSessionLiveAdapterMutation,
} from "../../ports/agent-session-live-adapter-port";
import type { OpenCodeRuntimeInstance } from "./opencode-live-session-normalization";
import { parseOutput, toControlSummary, toSessionRef } from "./opencode-live-session-normalization";
import type { OpenCodeLiveSessionState } from "./opencode-live-session-state";

type SerializeRuntime = <Success>(
  effect: Effect.Effect<Success, HostError>,
) => Effect.Effect<Success, HostError>;

type CommitMutation = <Value>(
  operation: string,
  mutation: () => AgentSessionLiveAdapterMutation<Value>,
) => Effect.Effect<Value, HostError>;

type CreateOpenCodeSessionControlAdapterInput = {
  readonly runtime: OpenCodeRuntimeInstance;
  readonly connection: OpencodeSessionRuntimeConnection;
  readonly state: OpenCodeLiveSessionState;
  readonly serializeRuntime: SerializeRuntime;
  readonly commit: CommitMutation;
};

export const createOpenCodeSessionControlAdapter = ({
  runtime,
  connection,
  state,
  serializeRuntime,
  commit,
}: CreateOpenCodeSessionControlAdapterInput): AgentSessionControlAdapterPort => {
  const runControlSummary = (
    operation: string,
    run: () => Promise<unknown>,
    parentExternalSessionId?: string,
  ): Effect.Effect<AgentSessionControlSummary, HostError> =>
    serializeRuntime(
      Effect.tryPromise({
        try: run,
        catch: (cause) =>
          toHostOperationError(cause, operation, {
            runtimeId: runtime.runtimeId,
          }),
      }).pipe(
        Effect.flatMap(toControlSummary),
        Effect.flatMap((summary) =>
          commit(`${operation}.commit`, () => ({
            value: summary,
            changes: state.retainControlSummary(summary, parentExternalSessionId),
          })),
        ),
      ),
    );

  return {
    startSession: (input) =>
      runControlSummary("opencode-live-session.start-session", () =>
        connection.startSession({
          repoPath: input.repoPath,
          runtimeKind: "opencode",
          runtimePolicy: { kind: "opencode" },
          workingDirectory: input.workingDirectory,
          sessionScope: input.sessionScope,
          systemPrompt: input.systemPrompt,
          ...(input.model ? { model: input.model } : {}),
        }),
      ),
    resumeSession: (input) =>
      runControlSummary("opencode-live-session.resume-session", () =>
        connection.resumeSession({
          ...toSessionRef(input),
          runtimeKind: "opencode",
          runtimePolicy: { kind: "opencode" },
          sessionScope: input.sessionScope,
          ...(input.model ? { model: input.model } : {}),
          ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
        }),
      ),
    forkSession: (input) =>
      runControlSummary(
        "opencode-live-session.fork-session",
        () =>
          connection.forkSession({
            repoPath: input.repoPath,
            runtimeKind: "opencode",
            runtimePolicy: { kind: "opencode" },
            workingDirectory: input.workingDirectory,
            sessionScope: input.sessionScope,
            systemPrompt: input.systemPrompt,
            parentExternalSessionId: input.parentExternalSessionId,
            ...(input.runtimeHistoryAnchor
              ? { runtimeHistoryAnchor: input.runtimeHistoryAnchor }
              : {}),
            ...(input.model ? { model: input.model } : {}),
          }),
        input.parentExternalSessionId,
      ),
    sendUserMessage: (input) =>
      serializeRuntime(
        Effect.tryPromise({
          try: () =>
            connection.sendUserMessage({
              ...toSessionRef(input),
              runtimeKind: "opencode",
              runtimePolicy: { kind: "opencode" },
              sessionScope: input.sessionScope,
              parts: input.parts as Parameters<
                OpencodeSessionRuntimeConnection["sendUserMessage"]
              >[0]["parts"],
              ...(input.model ? { model: input.model } : {}),
              ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
            }),
          catch: (cause) =>
            toHostOperationError(cause, "opencode-live-session.send-user-message", {
              runtimeId: runtime.runtimeId,
              externalSessionId: input.externalSessionId,
            }),
        }).pipe(
          Effect.flatMap((event) =>
            parseOutput(
              acceptedAgentUserMessageSchema,
              event,
              "opencode-live-session.normalize-user-message",
            ),
          ),
          Effect.flatMap((value) =>
            commit("opencode-live-session.commit-user-message", () => {
              const event = agentSessionTranscriptEventSchema.parse({
                ...value,
                sessionRef: toSessionRef(input),
              });
              return {
                value,
                changes: [...state.markRunning(input), { type: "transcript_event", event }],
              };
            }),
          ),
        ),
      ),
    updateSessionModel: (input) =>
      serializeRuntime(
        Effect.tryPromise({
          try: () => connection.updateSessionModel(input),
          catch: (cause) =>
            toHostOperationError(cause, "opencode-live-session.update-session-model", {
              runtimeId: runtime.runtimeId,
              externalSessionId: input.externalSessionId,
            }),
        }).pipe(
          Effect.flatMap(() =>
            commit("opencode-live-session.commit-model-update", () => ({
              value: undefined,
              changes: [],
            })),
          ),
        ),
      ),
    stopSession: (input) =>
      serializeRuntime(
        Effect.tryPromise({
          try: () => connection.stopSession(input),
          catch: (cause) =>
            toHostOperationError(cause, "opencode-live-session.stop-session", {
              runtimeId: runtime.runtimeId,
              externalSessionId: input.externalSessionId,
            }),
        }).pipe(
          Effect.flatMap(() =>
            commit("opencode-live-session.commit-stop-session", () => ({
              value: undefined,
              changes: state.removeSession(input),
            })),
          ),
        ),
      ),
    releaseSession: (input) =>
      serializeRuntime(
        Effect.tryPromise({
          try: () => connection.releaseSession(input),
          catch: (cause) =>
            toHostOperationError(cause, "opencode-live-session.release-session", {
              runtimeId: runtime.runtimeId,
              externalSessionId: input.externalSessionId,
            }),
        }).pipe(
          Effect.flatMap(() =>
            commit("opencode-live-session.commit-release-session", () => ({
              value: undefined,
              changes: state.removeSession(input),
            })),
          ),
        ),
      ),
  };
};
