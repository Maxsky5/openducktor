import type { OpencodeSessionRuntimeConnection } from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionControlSummary,
  type AgentSessionUserMessagePart,
  acceptedAgentUserMessageSchema,
  agentSessionTranscriptEventSchema,
} from "@openducktor/contracts";
import type { AgentSessionSummary, AgentUserMessagePart } from "@openducktor/core";
import { Effect } from "effect";
import { toAgentSessionControlMetadata } from "../../application/agent-sessions/agent-session-control-metadata";
import {
  type HostError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type {
  AgentSessionControlAdapterPort,
  AgentSessionLiveAdapterMutation,
} from "../../ports/agent-session-live-adapter-port";
import type { OpenCodeRuntimeInstance } from "./opencode-live-session-normalization";
import { parseOutput, refKey, toSessionRef } from "./opencode-live-session-normalization";
import type { createOpenCodeLiveSessionState } from "./opencode-live-session-state";

type OpenCodeLiveSessionState = ReturnType<typeof createOpenCodeLiveSessionState>;

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

const toOpenCodeUserMessagePart = (part: AgentSessionUserMessagePart): AgentUserMessagePart => {
  if (part.kind !== "attachment") return part;
  const { attachment } = part;
  const converted: Extract<AgentUserMessagePart, { kind: "attachment" }>["attachment"] = {
    id: attachment.id,
    path: attachment.path,
    name: attachment.name,
    kind: attachment.kind,
  };
  if (attachment.mime !== undefined) {
    converted.mime = attachment.mime;
  }
  return {
    kind: "attachment",
    attachment: converted,
  };
};

export const createOpenCodeSessionControlAdapter = ({
  runtime,
  connection,
  state,
  serializeRuntime,
  commit,
}: CreateOpenCodeSessionControlAdapterInput): AgentSessionControlAdapterPort => {
  const serializeSendBySession = new Map<string, SerializeRuntime>();

  const serializeSessionSend = <Success>(
    sessionKey: string,
    effect: Effect.Effect<Success, HostError>,
  ): Effect.Effect<Success, HostError> => {
    let serializeSend = serializeSendBySession.get(sessionKey);
    if (!serializeSend) {
      serializeSend = Effect.unsafeMakeSemaphore(1).withPermits(1);
      serializeSendBySession.set(sessionKey, serializeSend);
    }
    return serializeSend(effect);
  };

  const runControlSummary = (
    operation: string,
    run: () => Promise<AgentSessionSummary>,
  ): Effect.Effect<AgentSessionControlSummary, HostError> =>
    serializeRuntime(
      Effect.tryPromise({
        try: run,
        catch: (cause) =>
          toHostOperationError(cause, operation, {
            runtimeId: runtime.runtimeId,
          }),
      }).pipe(
        Effect.flatMap((summary) =>
          commit(`${operation}.commit`, () => ({
            value: summary,
            changes: state.retainControlSummary(summary),
          })),
        ),
        Effect.flatMap((summary) => toAgentSessionControlMetadata(summary, operation)),
      ),
    );

  return {
    startSession: (input) => {
      const request: Parameters<typeof connection.startSession>[0] = {
        repoPath: input.repoPath,
        runtimeKind: "opencode",
        runtimePolicy: { kind: "opencode" },
        workingDirectory: input.workingDirectory,
        sessionScope: input.sessionScope,
        systemPrompt: input.systemPrompt,
      };
      if (input.model) {
        request.model = input.model;
      }
      return runControlSummary("opencode-live-session.start-session", () =>
        connection.startSession(request),
      );
    },
    resumeSession: (input) => {
      const request: Parameters<typeof connection.resumeSession>[0] = {
        ...toSessionRef(input),
        runtimeKind: "opencode",
        runtimePolicy: { kind: "opencode" },
        sessionScope: input.sessionScope,
      };
      if (input.model) {
        request.model = input.model;
      }
      if (input.systemPrompt) {
        request.systemPrompt = input.systemPrompt;
      }
      return runControlSummary("opencode-live-session.resume-session", () =>
        connection.resumeSession(request),
      );
    },
    forkSession: (input) => {
      const request: Parameters<typeof connection.forkSession>[0] = {
        repoPath: input.repoPath,
        runtimeKind: "opencode",
        runtimePolicy: { kind: "opencode" },
        workingDirectory: input.workingDirectory,
        sessionScope: input.sessionScope,
        systemPrompt: input.systemPrompt,
        parentExternalSessionId: input.parentExternalSessionId,
      };
      if (input.runtimeHistoryAnchor) {
        request.runtimeHistoryAnchor = input.runtimeHistoryAnchor;
      }
      if (input.model) {
        request.model = input.model;
      }
      return runControlSummary("opencode-live-session.fork-session", () =>
        connection.forkSession(request),
      );
    },
    sendUserMessage: (input) => {
      const sessionRef = toSessionRef(input);
      const request: Parameters<typeof connection.sendUserMessage>[0] = {
        ...sessionRef,
        runtimeKind: "opencode",
        runtimePolicy: { kind: "opencode" },
        sessionScope: input.sessionScope,
        parts: input.parts.map(toOpenCodeUserMessagePart),
      };
      if (input.model) {
        request.model = input.model;
      }
      if (input.systemPrompt) {
        request.systemPrompt = input.systemPrompt;
      }
      return serializeSessionSend(
        refKey(sessionRef),
        Effect.tryPromise({
          try: () => connection.sendUserMessage(request),
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
            serializeRuntime(
              commit("opencode-live-session.commit-user-message", () => {
                if (!state.has(sessionRef)) {
                  throw new HostValidationError({
                    field: "externalSessionId",
                    message: `OpenCode session '${input.externalSessionId}' is no longer retained.`,
                    details: {
                      runtimeId: runtime.runtimeId,
                      externalSessionId: input.externalSessionId,
                    },
                  });
                }
                const event = agentSessionTranscriptEventSchema.parse({
                  ...value,
                  sessionRef,
                });
                return {
                  value,
                  changes: [{ type: "transcript_event", event }],
                };
              }),
            ),
          ),
        ),
      );
    },
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
