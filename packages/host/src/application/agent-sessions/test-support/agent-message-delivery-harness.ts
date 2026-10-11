import type {
  AcceptedAgentUserMessage,
  AgentMessageQueueAction,
  AgentMessageSubmitInput,
  AgentQueuedMessage,
  AgentSessionActivity,
  AgentSessionControlSendInput,
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
  AgentSessionUserMessagePart,
  AgentUserMessageDelivery,
} from "@openducktor/contracts";
import {
  type AgentDeliveryAvailability,
  AgentSessionMessageAcceptanceUnknownError,
  AgentSessionTurnActiveError,
} from "@openducktor/core";
import { Effect } from "effect";
import type { HostError } from "../../../effect/host-errors";
import {
  AgentSessionAcceptanceUnknownError,
  AgentSessionBusyError,
  AgentSessionMessageAcceptedError,
} from "../../../ports/agent-session-send-error";
import { createAgentMessageDeliveryService } from "../agent-message-delivery-service";

export const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo",
  externalSessionId: "session-1",
};
export const target = { ...ref, sessionScope: { kind: "repository" as const } };
export const model = { runtimeKind: "codex" as const, providerId: "openai", modelId: "gpt-5" };
export const slashCommand: AgentSessionUserMessagePart = {
  kind: "slash_command",
  command: { id: "compact", trigger: "compact", title: "Compact", hints: [] },
};

type TranscriptEvent = Extract<AgentSessionLiveEnvelope, { type: "transcript_event" }>["event"];
type SendResult = "accept" | "busy" | "unknown" | HostError;

const timestamp = "2026-10-08T10:00:00.000Z";

export const accepted = (input: AgentSessionControlSendInput): AcceptedAgentUserMessage => ({
  type: "user_message",
  externalSessionId: input.externalSessionId,
  timestamp,
  messageId: `message-${input.parts[0]?.kind === "text" ? input.parts[0].text : "other"}`,
  message: input.parts[0]?.kind === "text" ? input.parts[0].text : "",
  parts: [],
  state: "read",
});

/** The runtime took the message, but the host could not record it. */
export const acceptedThenFailed = (text: string, delivery: AgentUserMessageDelivery) =>
  new AgentSessionMessageAcceptedError(
    {
      sessionRef: ref,
      acceptedMessage: accepted({ ...target, parts: [{ kind: "text", text }], delivery }),
      stage: "record_message",
    },
    new Error("Save failed."),
  );

/** A live session state. A blocked session waits for an answer to an approval. */
export const sessionState = ({
  activity,
  blocked = false,
}: {
  readonly activity: AgentSessionActivity;
  readonly blocked?: boolean;
}): AgentSessionLiveSnapshot => ({
  ref,
  activity,
  title: "Chat",
  startedAt: "2026-10-08T09:00:00.000Z",
  pendingApprovals: blocked
    ? [{ requestId: "approval-1", requestType: "command_execution", title: "Run tests" }]
    : [],
  pendingQuestions: [],
  contextUsage: null,
});

const transcript = (event: TranscriptEvent): AgentSessionLiveEnvelope => ({
  type: "transcript_event",
  event,
});

export const turnEnd = (turnOutcome?: "completed" | "interrupted" | "failed") => {
  const event: Extract<TranscriptEvent, { type: "session_idle" }> = {
    type: "session_idle",
    externalSessionId: ref.externalSessionId,
    timestamp,
    sessionRef: ref,
  };
  if (turnOutcome) event.turnOutcome = turnOutcome;
  return transcript(event);
};

export const turnError = (message: string) =>
  transcript({
    type: "turn_error",
    externalSessionId: ref.externalSessionId,
    timestamp,
    message,
    sessionRef: ref,
  });

export const editIdOf = (entry: AgentQueuedMessage | undefined): string =>
  entry?.state === "editing" ? entry.editId : "missing";

export const failureOf = (promise: Promise<unknown>): Promise<Error | null> =>
  promise.then(
    () => null,
    (error: Error) => error,
  );

const sendFailure = (
  result: Exclude<SendResult, "accept">,
  input: AgentSessionControlSendInput,
) => {
  if (result === "busy") {
    return new AgentSessionBusyError({
      message: "A turn is running.",
      cause: new AgentSessionTurnActiveError(input.externalSessionId),
    });
  }
  if (result === "unknown") {
    const { messageId } = accepted(input);
    return new AgentSessionAcceptanceUnknownError({
      message: "Connection closed.",
      messageId,
      cause: new AgentSessionMessageAcceptanceUnknownError({
        externalSessionId: input.externalSessionId,
        messageId,
        cause: new Error("Connection closed."),
      }),
    });
  }
  return result;
};

/**
 * Runs the delivery service with a scripted runtime. Each send takes the next result from
 * `outcomes`, or accepts the message when none is left. Background work waits for
 * `runBackground`.
 */
export const createHarness = (steering: AgentDeliveryAvailability = { available: true }) => {
  const calls: { readonly input: AgentSessionControlSendInput }[] = [];
  const outcomes: SendResult[] = [];
  const envelopes: AgentSessionLiveEnvelope[] = [];
  const background: Effect.Effect<void>[] = [];
  let onSend: (() => void) | null = null;
  const service = createAgentMessageDeliveryService({
    // A configured path can name the repository through a link, like `/repo-link`.
    canonicalizeRepoPath: (repoPath) =>
      Effect.succeed(repoPath === "/repo-link" ? "/repo" : repoPath.replace(/\/$/, "")),
    prepare: (content) => Effect.succeed({ ...content, model }),
    send: (input) =>
      Effect.suspend(() => {
        calls.push({ input });
        onSend?.();
        const result = outcomes.shift() ?? "accept";
        return result === "accept"
          ? Effect.succeed(accepted(input))
          : Effect.fail(sendFailure(result, input));
      }),
    steeringAvailability: () => Effect.succeed(steering),
    publish: (envelope) => envelopes.push(envelope),
    runInBackground: (effect) => background.push(effect),
    now: () => "2026-10-08T09:00:00.000Z",
  });
  const submitParts = (
    submissionId: string,
    parts: AgentMessageSubmitInput["parts"],
    mode: AgentMessageSubmitInput["mode"] = "default",
  ) =>
    Effect.runPromise(
      service.submit({
        ...target,
        repoPath: "/repo/",
        submissionId,
        mode,
        parts,
        model: { runtimeKind: "codex", providerId: "openai", modelId: "ignored" },
      }),
    );
  const userMessage = (messageId: string, submissionId?: string) => {
    const event: Extract<TranscriptEvent, { type: "user_message" }> = {
      type: "user_message",
      externalSessionId: ref.externalSessionId,
      timestamp,
      sessionRef: ref,
      messageId,
      message: "first",
      parts: [{ kind: "text", text: "first" }],
      state: "read",
    };
    if (submissionId) event.submissionId = submissionId;
    service.observeChanges([transcript(event)]);
  };
  return {
    calls,
    envelopes,
    outcomes,
    service,
    submitParts,
    userMessage,
    submit: (text: string, mode: AgentMessageSubmitInput["mode"] = "default") =>
      submitParts(`submission-${text}`, [{ kind: "text", text }], mode),
    manage: (action: AgentMessageQueueAction) =>
      Effect.runPromise(service.manage({ ...target, action })),
    runBackground: async () => {
      while (background.length > 0) {
        const next = background.shift();
        if (next) await Effect.runPromise(next);
      }
    },
    setOnSend: (callback: () => void) => {
      onSend = callback;
    },
    stop: (stopRef: typeof ref = ref) => Effect.runSync(service.pauseForStop(stopRef)),
    idle: () => service.observeChanges([turnEnd("completed")]),
    upsertSession: (state: Parameters<typeof sessionState>[0]) =>
      service.observeChanges([{ type: "session_upsert", session: sessionState(state) }]),
    queueTexts: () =>
      service
        .listQueues("/repo")
        .flatMap((queue) =>
          queue.entries.map((entry) =>
            entry.parts[0]?.kind === "text" ? `${entry.parts[0].text}:${entry.state}` : "",
          ),
        ),
    pause: () => service.listQueues("/repo")[0]?.pause?.message ?? null,
    sentTexts: () =>
      calls.map(({ input }) =>
        input.parts[0]?.kind === "text" ? `${input.parts[0].text}:${input.delivery}` : "",
      ),
  };
};

export type DeliveryHarness = ReturnType<typeof createHarness>;
