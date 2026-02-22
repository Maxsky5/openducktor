import type { OpencodeClient, Part } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { handleMessageEvent } from "./event-stream/message-events";
import { handleSessionEvent } from "./event-stream/session-events";
import { isRelevantEvent } from "./event-stream/shared";
import type { SessionInput, SessionRecord } from "./types";

type SubscribeOpencodeEventsInput = {
  context: {
    sessionId: string;
    externalSessionId: string;
    input: SessionInput;
  };
  client: OpencodeClient;
  controller: AbortController;
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
  getSession: (sessionId: string) => SessionRecord | undefined;
};

export const subscribeOpencodeEvents = async (
  input: SubscribeOpencodeEventsInput,
): Promise<void> => {
  const sse = await input.client.event.subscribe(
    { directory: input.context.input.workingDirectory },
    { signal: input.controller.signal },
  );
  const partsById = new Map<string, Part>();
  const messageRoleById = new Map<string, string>();
  const pendingDeltasByPartId = new Map<string, Array<{ field: string; delta: string }>>();
  const runtime = {
    sessionId: input.context.sessionId,
    externalSessionId: input.context.externalSessionId,
    input: input.context.input,
    now: input.now,
    emit: input.emit,
    getSession: input.getSession,
    partsById,
    messageRoleById,
    pendingDeltasByPartId,
  };

  for await (const event of sse.stream) {
    if (!isRelevantEvent(input.context.externalSessionId, event)) {
      continue;
    }

    if (handleMessageEvent(event, runtime)) {
      continue;
    }
    handleSessionEvent(event, runtime);
  }
};
