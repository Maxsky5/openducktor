import { unexpectedNativeSessionImport } from "../../test-support/session-import-test-doubles";
import { unexpectedNativeRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import type {
  OpencodeNativeApprovalReply,
  OpencodeNativeQuestionReply,
  OpencodeRuntimeSnapshotFailure,
  OpencodeRuntimeSnapshotSource,
  OpencodeSessionRuntimeConnection,
  OpencodeSessionRuntimeSignal,
  PrepareOpencodeSessionRuntime,
} from "@openducktor/adapters-opencode-sdk";
import type { RuntimeInstanceSummary } from "@openducktor/contracts";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect } from "effect";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";

export const runtime: RuntimeInstanceSummary = {
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:43123" },
  startedAt: "2026-07-16T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
};

export const ref = {
  repoPath: "/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
};

export const controlMetadata = {
  externalSessionId: "controlled-session",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktree",
  title: "Controlled session",
  startedAt: "2026-07-16T10:02:00.000Z",
  status: "running" as const,
};

export const controlSummary = {
  ...controlMetadata,
  sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" } as const,
};

export const acceptedMessageText = "Hello";

type ControlCall = {
  [
    Operation in
      | "start"
      | "resume"
      | "continue"
      | "fork"
      | "send"
      | "model"
      | "title"
      | "stop"
      | "release"
  ]: {
    operation: Operation;
    input: Parameters<
      OpencodeSessionRuntimeConnection[{
        start: "startSession";
        resume: "resumeSession";
        continue: "continueInterruptedTurn";
        fork: "forkSession";
        send: "sendUserMessage";
        model: "updateSessionModel";
        title: "updateSessionTitle";
        stop: "stopSession";
        release: "releaseSession";
      }[Operation]]
    >[0];
  };
}["start" | "resume" | "continue" | "fork" | "send" | "model" | "title" | "stop" | "release"];

type RuntimeHarness = {
  readonly prepareRuntime: PrepareOpencodeSessionRuntime;
  readonly emit: (signal: OpencodeSessionRuntimeSignal) => Promise<void>;
  readonly approvalReplies: OpencodeNativeApprovalReply[];
  readonly questionReplies: OpencodeNativeQuestionReply[];
  readonly controlCalls: ControlCall[];
  readonly releaseCalls: string[];
  readonly contextLoadCalls: string[];
  readonly sessionSourceReadCalls: number;
};

export const createRuntimeHarness = (
  options: {
    readonly continueInterruptedTurnError?: Error;
    readonly continueInterruptedTurnBarrier?: Promise<void>;
    readonly onContinueInterruptedTurn?: () => void;
    readonly sendUserMessageBarrier?: Promise<void>;
    readonly onSendUserMessage?: () => void;
    readonly sessionFailures?: OpencodeRuntimeSnapshotFailure[];
    readonly sessionSources?: OpencodeRuntimeSnapshotSource[];
  } = {},
): RuntimeHarness => {
  let listener: ((signal: OpencodeSessionRuntimeSignal) => void | Promise<void>) | null = null;
  const approvalReplies: OpencodeNativeApprovalReply[] = [];
  const questionReplies: OpencodeNativeQuestionReply[] = [];
  const controlCalls: ControlCall[] = [];
  const releaseCalls: string[] = [];
  const contextLoadCalls: string[] = [];
  let sessionSourceReadCalls = 0;

  const connection: OpencodeSessionRuntimeConnection = {
    readSessionSources: async () => {
      sessionSourceReadCalls += 1;
      return {
        sources: options.sessionSources ?? [],
        failures: options.sessionFailures ?? [],
      };
    },
    loadContextUsage: async (input) => {
      contextLoadCalls.push(input.externalSessionId);
      return {
        totalTokens: 999,
        model: { providerId: "openai", modelId: "gpt-5.1" },
      };
    },
    replyApproval: async (input) => {
      approvalReplies.push(input);
    },
    replyQuestion: async (input) => {
      questionReplies.push(input);
    },
    startSession: async (input) => {
      controlCalls.push({ operation: "start", input });
      return controlSummary;
    },
    resumeSession: async (input) => {
      controlCalls.push({ operation: "resume", input });
      return {
        ...controlSummary,
        externalSessionId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
        sessionAssociation: input.sessionScope,
      };
    },
    continueInterruptedTurn: async (input) => {
      controlCalls.push({ operation: "continue", input });
      if (options.continueInterruptedTurnError) {
        throw options.continueInterruptedTurnError;
      }
      options.onContinueInterruptedTurn?.();
      await options.continueInterruptedTurnBarrier;
      return {
        ...controlSummary,
        externalSessionId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
        sessionAssociation: input.sessionScope,
      };
    },
    forkSession: async (input) => {
      controlCalls.push({ operation: "fork", input });
      return controlSummary;
    },
    sendUserMessage: async (input) => {
      controlCalls.push({ operation: "send", input });
      options.onSendUserMessage?.();
      await options.sendUserMessageBarrier;
      return {
        type: "user_message",
        externalSessionId: input.externalSessionId,
        timestamp: "2026-07-16T10:03:00.000Z",
        messageId: "user-1",
        message: acceptedMessageText,
        parts: [{ kind: "text", text: acceptedMessageText }],
        state: "queued",
      };
    },
    updateSessionModel: async (input) => {
      controlCalls.push({ operation: "model", input });
    },
    updateSessionTitle: async (input) => {
      controlCalls.push({ operation: "title", input });
      return {
        status: "renamed",
        summary: {
          ...controlSummary,
          externalSessionId: input.externalSessionId,
          title: input.title,
        },
      };
    },
    stopSession: async (input) => {
      controlCalls.push({ operation: "stop", input });
    },
    releaseSession: async (input) => {
      controlCalls.push({ operation: "release", input });
    },
  };

  return {
    prepareRuntime: async (input) => ({
      queries: unexpectedNativeRuntimeQueries,
      sessionImport: unexpectedNativeSessionImport,
      connection,
      startForwarding: async (nextListener) => {
        listener = nextListener;
      },
      release: async () => {
        releaseCalls.push(input.runtimeId);
        listener = null;
      },
    }),
    emit: async (signal) => {
      if (!listener) {
        throw new Error("Forwarding has not started.");
      }
      await listener(signal);
    },
    approvalReplies,
    questionReplies,
    controlCalls,
    releaseCalls,
    contextLoadCalls,
    get sessionSourceReadCalls() {
      return sessionSourceReadCalls;
    },
  };
};

export const createLifecycle = (
  changes: AgentSessionLiveAdapterChange[],
): RuntimeLiveSessionLifecyclePort => ({
  registerRuntimeAdapter: () => Effect.void,
  releaseRuntime: () => Effect.succeed([]),
  createRuntimeRegistration: (binding) =>
    new AgentSessionLiveRegistration(binding, (mutation) =>
      mutation.pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            changes.push(...result.changes);
          }),
        ),
        Effect.map((result) => result.value),
      ),
    ),
});
