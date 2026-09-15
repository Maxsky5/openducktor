import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { interruptedTurnResumeError } from "@openducktor/core";
import { unwrapData } from "./data-utils";
import {
  opencodeSessionMessagesPayloadSchema,
  type ParsedOpencodeMessage,
} from "./opencode-ingress";
import { toOpencodeSessionStatusMap } from "./live-session-snapshots";
import { toOpenCodeRequestError } from "./request-errors";

type OpencodeSessionMessageEntry = {
  readonly info: ParsedOpencodeMessage["info"];
  readonly parts: ParsedOpencodeMessage["parts"];
};

/**
 * A continuation artifact is a native OpenCode user row with no parts.
 * It is created by `prompt_async` with `parts: []` and must never reach shared state.
 */
export const isOpencodeContinuationArtifactEntry = (entry: {
  readonly info: Pick<ParsedOpencodeMessage["info"], "role">;
  readonly parts: ReadonlyArray<unknown>;
}): boolean => entry.info.role === "user" && entry.parts.length === 0;

const hasCompletedAssistantMessage = (info: ParsedOpencodeMessage["info"]): boolean =>
  info.role === "assistant" && info.time.completed !== undefined;

export type OpencodeInterruptedTurnProbe =
  | { readonly kind: "unfinished_turn" }
  | { readonly kind: "completed_turn" }
  | { readonly kind: "live_turn" }
  | { readonly kind: "no_unfinished_turn" };

export type ProbeOpencodeInterruptedTurnInput = {
  readonly client: OpencodeClient;
  readonly workingDirectory: string;
  readonly externalSessionId: string;
};

const readSessionMessages = async (
  input: ProbeOpencodeInterruptedTurnInput,
): Promise<OpencodeSessionMessageEntry[]> => {
  const response = await input.client.session.messages({
    sessionID: input.externalSessionId,
    directory: input.workingDirectory,
  });
  const parsed = opencodeSessionMessagesPayloadSchema.parse(
    unwrapData(response, "load session messages"),
  );
  return [...parsed].sort((left, right) => left.info.time.created - right.info.time.created);
};

const isLiveStatus = (status: { type: string } | undefined): boolean =>
  status?.type === "busy" || status?.type === "retry";

/**
 * Reads the authoritative OpenCode session status and native message rows.
 * It never inspects display text; completion comes from `time.completed`.
 */
export const probeOpencodeInterruptedTurn = async (
  input: ProbeOpencodeInterruptedTurnInput,
): Promise<OpencodeInterruptedTurnProbe> => {
  const statusResponse = await input.client.session.status({
    directory: input.workingDirectory,
  });
  const statuses = toOpencodeSessionStatusMap(
    unwrapData(statusResponse, "get session status"),
    input.workingDirectory,
  );
  if (isLiveStatus(statuses[input.externalSessionId])) {
    return { kind: "live_turn" };
  }

  const messages = await readSessionMessages(input);
  const latestUserIndex = messages.findLastIndex(
    (entry) => entry.info.role === "user" && !isOpencodeContinuationArtifactEntry(entry),
  );
  if (latestUserIndex < 0) {
    return { kind: "no_unfinished_turn" };
  }

  const assistantReplies = messages.slice(latestUserIndex + 1);
  if (assistantReplies.some((entry) => hasCompletedAssistantMessage(entry.info))) {
    return { kind: "completed_turn" };
  }
  return { kind: "unfinished_turn" };
};

export type ContinueOpencodeInterruptedTurnInput = ProbeOpencodeInterruptedTurnInput & {
  readonly modelInput?: {
    readonly model?: { readonly providerID: string; readonly modelID: string };
    readonly variant?: string;
    readonly agent?: string;
  };
  readonly tools?: Record<string, boolean>;
  readonly systemPrompt?: string;
};

/**
 * Starts exactly one no-text OpenCode turn by calling `prompt_async` with `parts: []`.
 * The server loop continues the unfinished turn; no user message is admitted.
 */
export const continueOpencodeInterruptedTurn = async (
  input: ContinueOpencodeInterruptedTurnInput,
): Promise<void> => {
  const request: Parameters<OpencodeClient["session"]["promptAsync"]>[0] = {
    sessionID: input.externalSessionId,
    directory: input.workingDirectory,
    parts: [],
  };
  const modelInput = input.modelInput;
  if (modelInput?.model) {
    request.model = modelInput.model;
  }
  if (modelInput?.variant) {
    request.variant = modelInput.variant;
  }
  if (modelInput?.agent) {
    request.agent = modelInput.agent;
  }
  if (input.tools) {
    request.tools = input.tools;
  }
  if (input.systemPrompt && input.systemPrompt.trim().length > 0) {
    request.system = input.systemPrompt;
  }
  const response = await input.client.session.promptAsync(request);
  if (response.error) {
    throw toOpenCodeRequestError("prompt session", response.error, response.response);
  }
};

export const toOpencodeInterruptedTurnResumeError = (
  probe: Exclude<OpencodeInterruptedTurnProbe, { kind: "unfinished_turn" }>,
  externalSessionId: string,
) => {
  switch (probe.kind) {
    case "live_turn":
      return interruptedTurnResumeError({
        reason: "live_turn",
        message: `OpenCode session '${externalSessionId}' has a live turn.`,
      });
    case "completed_turn":
      return interruptedTurnResumeError({
        reason: "completed_turn",
        message: `OpenCode session '${externalSessionId}' has a completed latest turn.`,
      });
    case "no_unfinished_turn":
      return interruptedTurnResumeError({
        reason: "ineligible_turn_state",
        message: `OpenCode session '${externalSessionId}' has no unfinished user turn to continue.`,
      });
  }
};
